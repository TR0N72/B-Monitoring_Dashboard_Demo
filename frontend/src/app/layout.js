import { Inter, Manrope } from 'next/font/google';
import '@/styles/globals.css';
import { AuthProvider } from '@/context/AuthContext';
import { SocketProvider } from '@/context/SocketContext';
import { ThemeProvider } from '@/context/ThemeContext';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
  display: 'swap',
  weight: ['600', '700', '800'],
});

export const metadata = {
  title: 'B-Monitor — LoRa Water Quality Monitoring',
  description: 'Real-time water quality monitoring dashboard for milkfish pond management using ESP32 and LoRa technology.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${manrope.variable}`}>
      <body>
        <AuthProvider>
          {/* SocketProvider harus di dalam AuthProvider agar bisa membaca token auth */}
          <SocketProvider>
            <ThemeProvider>
              {children}
            </ThemeProvider>
          </SocketProvider>
        </AuthProvider>
      </body>
    </html>
  );
}