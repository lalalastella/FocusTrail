import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'ADTI 注意力人格测试｜FocusTrail',
  description: '面向大学生的 AI 执行恢复辅助工具。选择四维行为轴，查看你的 ADTI 注意力人格、IP形象与个性化建议。',
  icons: {
    icon: [
      { url: '/focustrail-logo.svg', type: 'image/svg+xml' },
      { url: '/focustrail-logo-1024.png', type: 'image/png', sizes: '1024x1024' },
    ],
    shortcut: '/focustrail-logo.svg',
    apple: '/focustrail-logo-1024.png',
  },
  openGraph: {
    title: 'ADTI 注意力人格测试｜FocusTrail',
    description: '偏了吗？看看你的注意力会怎么走。',
    images: [{ url: '/og.png', width: 1731, height: 909, alt: 'ADTI 注意力人格测试' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ADTI 注意力人格测试｜FocusTrail',
    description: '偏了吗？看看你的注意力会怎么走。',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
