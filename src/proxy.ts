import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;
    const role = token?.role;

    // Force users with a temporary password to change it before doing anything else
    if (token?.must_change_password && pathname !== '/change-password') {
      return NextResponse.redirect(new URL('/change-password', req.url));
    }
    // Don't let users without a pending change sit on /change-password
    if (token && !token.must_change_password && pathname === '/change-password') {
      return NextResponse.redirect(new URL('/activity', req.url));
    }

    if (pathname.startsWith('/admin') && role !== 'admin' && role !== 'ceo') {
      return NextResponse.redirect(new URL('/activity', req.url));
    }
    if (pathname.startsWith('/team') && role === 'agent') {
      return NextResponse.redirect(new URL('/activity', req.url));
    }
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: ['/simulator/:path*', '/admin/:path*', '/activity/:path*', '/dashboard/:path*', '/team/:path*', '/change-password'],
};
