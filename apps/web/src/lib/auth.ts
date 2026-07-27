import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { recoverMessageAddress } from "viem";
import { db } from "./db";

const SIWE_MAX_AGE_MS = 10 * 60 * 1000;

/** Extract the fields we must validate from the signed SIWE message. */
function parseSiweMessage(
  message: string
): { address: string; nonce: string; issuedAt: string } | null {
  const lines = message.split("\n");
  const address = lines[1]?.trim() ?? "";
  const nonce = /^Nonce: (.+)$/m.exec(message)?.[1]?.trim() ?? "";
  const issuedAt = /^Issued At: (.+)$/m.exec(message)?.[1]?.trim() ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !nonce || !issuedAt) return null;
  return { address, nonce, issuedAt };
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db),
  secret: process.env.NEXTAUTH_SECRET ?? "dev-secret-change-in-production",
  session: { strategy: "jwt" },
  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
  providers: [
    CredentialsProvider({
      id: "credentials",
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await db.user.findUnique({ where: { email: credentials.email } });
        if (!user?.passwordHash) return null;
        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
    CredentialsProvider({
      id: "siwe",
      name: "Wallet",
      credentials: {
        address: { label: "Wallet Address", type: "text" },
        signature: { label: "Signature", type: "text" },
        message: { label: "Message", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.address || !credentials.signature || !credentials.message) return null;
        const addr = credentials.address.toLowerCase();

        // 1. The signed message must claim the same address it's used for.
        const parsed = parseSiweMessage(credentials.message);
        if (!parsed || parsed.address.toLowerCase() !== addr) return null;

        // 2. Freshness: reject stale messages outright.
        const issuedAtMs = Date.parse(parsed.issuedAt);
        if (!Number.isFinite(issuedAtMs) || Math.abs(Date.now() - issuedAtMs) > SIWE_MAX_AGE_MS) {
          return null;
        }

        // 3. Single-use server-issued nonce (replay protection): it must
        //    exist for this address, be unexpired, and is consumed here.
        const identifier = `siwe:${addr}`;
        const stored = await db.verificationToken.findFirst({
          where: { identifier, token: parsed.nonce },
        });
        if (!stored || stored.expires < new Date()) return null;
        await db.verificationToken.deleteMany({ where: { identifier } });

        // 4. Cryptographic proof: the signature must recover to the address.
        try {
          const recovered = await recoverMessageAddress({
            message: credentials.message,
            signature: credentials.signature as `0x${string}`,
          });
          if (recovered.toLowerCase() !== addr) return null;
        } catch {
          return null;
        }

        const user = await db.user.upsert({
          where: { address: addr },
          create: { address: addr, name: `${addr.slice(0, 6)}…${addr.slice(-4)}` },
          update: {},
        });
        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.userId = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.userId) (session.user as { id?: string }).id = token.userId as string;
      return session;
    },
  },
};
