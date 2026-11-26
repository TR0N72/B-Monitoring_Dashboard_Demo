"""Backup harian DB bmonitor: mysqldump di dalam container -> .sql.gz di luar repo.

Password root dibaca container dari env-nya sendiri, tidak pernah lewat host/argumen.
Pakai:  python scripts/backup_db.py            (backup + pruning)
        python scripts/backup_db.py --verify   (backup + uji restore ke DB sementara)
ponytail: satu salinan lokal di laptop yang sama; salin folder ke disk/cloud lain untuk tahan kerusakan disk.
"""
import gzip, os, shutil, subprocess, sys, time
from pathlib import Path

CONTAINER = 'bmonitor-mysql'
DEST = Path(os.environ.get('BMON_BACKUP_DIR', 'C:/CApstone-backups'))
KEEP = int(os.environ.get('BMON_BACKUP_KEEP', '14'))
MIN_BYTES = 2000  # dump valid selalu lebih besar (skema 12 tabel)

def sh(cmd, stdout=None, check=True):
    return subprocess.run(['docker', 'exec', '-i', CONTAINER, 'sh', '-c', cmd],
                          stdout=stdout, stderr=subprocess.PIPE, check=check)

def backup():
    DEST.mkdir(parents=True, exist_ok=True)
    name = DEST / f"bmonitor-{time.strftime('%Y%m%d-%H%M%S')}.sql.gz"
    part = name.with_suffix('.part')
    dump = ('mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines --triggers '
            '--no-tablespaces --databases "$MYSQL_DATABASE" 2>/dev/null')
    p = subprocess.Popen(['docker', 'exec', CONTAINER, 'sh', '-c', dump], stdout=subprocess.PIPE)
    with open(part, 'wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb') as gz:
        shutil.copyfileobj(p.stdout, gz)
    if p.wait() != 0:
        part.unlink(missing_ok=True)
        sys.exit('mysqldump gagal (container mati?)')
    with gzip.open(part, 'rb') as f:
        data = f.read()
    if len(data) < MIN_BYTES or b'Dump completed' not in data[-300:]:
        part.unlink(missing_ok=True)
        sys.exit('dump tidak lengkap, file dibuang')
    part.replace(name)
    for old in sorted(DEST.glob('bmonitor-*.sql.gz'))[:-KEEP]:
        old.unlink()
    print(f'OK {name} {name.stat().st_size} bytes, {len(list(DEST.glob("bmonitor-*.sql.gz")))} file disimpan')
    return name

def verify(name):
    """Restore ke DB sementara, bandingkan jumlah tabel, lalu hapus DB sementara."""
    tmp = 'zz_restore_test'
    sql = gzip.open(name, 'rb').read().decode('utf-8', 'replace')
    db = sh('echo $MYSQL_DATABASE', stdout=subprocess.PIPE).stdout.decode().strip()
    sql = sql.replace(f'`{db}`', f'`{tmp}`')
    mysql = 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" 2>/dev/null'
    try:
        sh(f'{mysql} -e "DROP DATABASE IF EXISTS {tmp}"')
        r = subprocess.run(['docker', 'exec', '-i', CONTAINER, 'sh', '-c', mysql], input=sql.encode(), capture_output=True)
        if r.returncode: sys.exit('restore gagal')
        q = lambda d: sh(f'{mysql} -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=\'{d}\'"',
                         stdout=subprocess.PIPE).stdout.decode().strip()
        a, b = q(db), q(tmp)
        rows = lambda d: sh(f'{mysql} -N -e "SELECT COUNT(*) FROM {d}.sensor_data"', stdout=subprocess.PIPE).stdout.decode().strip()
        print(f'verify: tabel asli={a} restore={b}; sensor_data asli={rows(db)} restore={rows(tmp)}')
        if a != b:
            sys.exit('VERIFY GAGAL: jumlah tabel beda')
    finally:
        sh(f'{mysql} -e "DROP DATABASE IF EXISTS {tmp}"', check=False)
        left = sh(f'{mysql} -N -e "SHOW DATABASES LIKE \'{tmp}\'"', stdout=subprocess.PIPE, check=False).stdout.decode().strip()
        print('DB sementara sisa:', left or 'tidak ada')

if __name__ == '__main__':
    f = backup()
    if '--verify' in sys.argv:
        verify(f)
