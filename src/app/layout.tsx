export const metadata = {
  title: "Projstalker API",
  description: "Backend for the Projstalker social media deep research app",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
