import os
import json
import pika
import mysql.connector
import urllib.request
import urllib.parse
from datetime import datetime
from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_CHAT_ID = os.getenv('TELEGRAM_CHAT_ID', '')

def get_mysql_conn():
    return mysql.connector.connect(
        host=os.getenv('MYSQL_HOST'),
        user=os.getenv('MYSQL_USER'),
        password=os.getenv('MYSQL_PASSWORD'),
        database=os.getenv('MYSQL_DATABASE')
    )

def get_influx_client():
    return InfluxDBClient(
        url=os.getenv('INFLUX_URL'),
        token=os.getenv('INFLUX_TOKEN'),
        org=os.getenv('INFLUX_ORG')
    )

def send_telegram_alert(alert_data):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return

    emoji = '\U0001F6A8' if alert_data['level'] == 'critical' else '\u26A0\uFE0F'
    status_bar = '\U0001F534\U0001F534\U0001F534' if alert_data['level'] == 'critical' else '\U0001F7E1\U0001F7E1\U0001F7E1'

    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    message = (
        f"{status_bar}\n"
        f"{emoji} *B-Monitor Alert* {emoji}\n\n"
        f"*Level:* {alert_data['level'].upper()}\n"
        f"*Device:* `{alert_data['device_id']}`\n"
        f"*Parameter:* {alert_data['parameter']}\n"
        f"*Value:* {alert_data['value']}\n"
        f"*Range:* {alert_data['min']} — {alert_data['max']}\n\n"
        f"\U0001F4DD {alert_data['message']}\n\n"
        f"\U0001F550 {now}"
    )

    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        data = urllib.parse.urlencode({
            'chat_id': TELEGRAM_CHAT_ID,
            'text': message,
            'parse_mode': 'Markdown',
            'disable_web_page_preview': 'true',
        }).encode('utf-8')
        req = urllib.request.Request(url, data=data)
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode('utf-8'))
            if result.get('ok'):
                print(f"[Telegram] Alert sent: {alert_data['level']} — {alert_data['parameter']}")
            else:
                print(f"[Telegram] API error: {result.get('description')}")
    except Exception as e:
        print(f"[Telegram] Failed to send: {e}")

def check_thresholds(device_id, parameters, mysql_conn):
    cursor = mysql_conn.cursor(dictionary=True)

    cursor.execute("SELECT id FROM devices WHERE device_id = %s", (device_id,))
    device = cursor.fetchone()
    if not device:
        return

    internal_id = device['id']

    cursor.execute("SELECT parameter, batas_bawah, batas_atas FROM threshold_config WHERE device_id = %s", (internal_id,))
    thresholds = {t['parameter']: t for t in cursor.fetchall()}

    for param, value in parameters.items():
        if param in thresholds:
            t = thresholds[param]
            if value < float(t['batas_bawah']) or value > float(t['batas_atas']):
                level = 'critical' if value < (float(t['batas_bawah']) * 0.8) or value > (float(t['batas_atas']) * 1.2) else 'warning'
                msg = f"Parameter {param} out of range: {value} (Limit: {t['batas_bawah']} - {t['batas_atas']})"

                cursor.execute("""
                    INSERT INTO alert_logs (device_id, parameter, measured_value, threshold_min, threshold_max, level_peringatan, pesan_notifikasi)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (internal_id, param, value, t['batas_bawah'], t['batas_atas'], level, msg))

                send_telegram_alert({
                    'device_id': device_id,
                    'parameter': param,
                    'value': value,
                    'min': float(t['batas_bawah']),
                    'max': float(t['batas_atas']),
                    'level': level,
                    'message': msg,
                })

    cursor.execute("UPDATE devices SET last_seen = NOW(), status = 'online' WHERE id = %s", (internal_id,))
    mysql_conn.commit()
    cursor.close()

def callback(ch, method, properties, body):
    try:
        data = json.loads(body)
        device_id = data.get('device_id')
        readings = data.get('readings', {})

        if not device_id:
            return

        influx_client = get_influx_client()
        write_api = influx_client.write_api(write_options=SYNCHRONOUS)

        point = Point("sensor_readings").tag("device_id", device_id)
        for k, v in readings.items():
            point = point.field(k, float(v))

        write_api.write(bucket=os.getenv('INFLUX_BUCKET'), record=point)
        influx_client.close()

        mysql_conn = get_mysql_conn()
        check_thresholds(device_id, readings, mysql_conn)
        mysql_conn.close()

        ch.basic_ack(delivery_tag=method.delivery_tag)

    except Exception as e:
        print(f"Error processing message: {e}")

def main():
    if TELEGRAM_BOT_TOKEN:
        print(f"[Telegram] Bot configured, chat_id: {TELEGRAM_CHAT_ID}")
    else:
        print("[Telegram] Not configured (TELEGRAM_BOT_TOKEN missing)")

    try:
        connection = pika.BlockingConnection(pika.URLParameters(os.getenv('RABBITMQ_URL')))
        channel = connection.channel()

        channel.queue_declare(queue='sensor_data', durable=True)
        channel.basic_qos(prefetch_count=1)
        channel.basic_consume(queue='sensor_data', on_message_callback=callback)

        print("Waiting for messages...")
        channel.start_consuming()
    except Exception as e:
        print(f"Connection error: {e}")

if __name__ == "__main__":
    main()
