import { NextResponse } from "next/server";

export function proxy(request) {
  const { pathname } = request.nextUrl;

  if (pathname === "/admin/login") {
    if (request.cookies.has("alma_token")) {
      return NextResponse.redirect(new URL("/admin/agenda", request.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/admin")) {
    if (!request.cookies.has("alma_token")) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
