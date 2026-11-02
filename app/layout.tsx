import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = { title:'Wardrobe Viewer · Batch Merch',description:'An interactive collection of graphic tees and heavyweight essentials.',icons:{icon:'/favicon.svg',shortcut:'/favicon.svg'} };
export const viewport: Viewport = {width:'device-width',initialScale:1,viewportFit:'cover',interactiveWidget:'resizes-content'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>;}
