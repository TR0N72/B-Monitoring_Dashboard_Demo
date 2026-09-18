/**
 * useSocket — re-exports hook dari SocketContext.
 *
 * Hook ini tidak lagi membuat koneksi WebSocket sendiri.
 * Satu koneksi tunggal dikelola oleh SocketProvider di layout.js,
 * sehingga semua komponen berbagi koneksi yang sama.
 *
 * Import path '@/hooks/useSocket' tetap bisa digunakan tanpa perubahan
 * di komponen yang sudah ada (AlertBanner, dss/page, actuator/page).
 */
export { useSocket } from '@/context/SocketContext';