import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { JWT } from "next-auth/jwt";

const GATEWAY = process.env.NEXT_PUBLIC_API_GATEWAY_URL ?? "http://localhost:8080";

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        address: { label: "Wallet Address", type: "text" },
        signature: { label: "Signature", type: "text" },
        message: { label: "Message", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.address || !credentials?.signature) return null;

        try {
          const res = await fetch(`${GATEWAY}/api/v1/auth/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              address: credentials.address,
              signature: credentials.signature,
              message: credentials.message,
            }),
          });

          if (!res.ok) return null;

          const { user, accessToken } = await res.json();
          return { ...user, accessToken };
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.accessToken = (user as any).accessToken;
        token.address = (user as any).address;
      }
      return token;
    },
    async session({ session, token }) {
      (session as any).accessToken = token.accessToken;
      (session.user as any).address = token.address;
      return session;
    },
  },
};
