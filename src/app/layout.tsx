import { Providers } from "./providers";

export const metadata = {
  title: "WorkSafe AI",
  description: "Cổng AI nội bộ: che dữ liệu khách hàng, nới quy tắc và mở lịch sử đều cần quorum admin",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "2rem", background: "#0a0a0a", color: "#ededed" }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
