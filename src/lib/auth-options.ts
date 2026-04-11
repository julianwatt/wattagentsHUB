import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { findByUsername, verifyPassword } from './users';
import { UserRole } from './supabase';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        username: { label: 'Usuario', type: 'text' },
        password: { label: 'Contraseña', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;
        const user = await findByUsername(credentials.username);
        if (!user) return null;
        const valid = await verifyPassword(user, credentials.password);
        if (!valid) return null;
        return {
          id: user.id,
          name: user.name,
          email: user.email ?? user.username,
          role: user.role as UserRole,
          username: user.username,
          must_change_password: user.must_change_password,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.role = (user as { role: UserRole }).role;
        token.username = (user as { username: string }).username;
        token.id = user.id;
        token.must_change_password = (user as { must_change_password: boolean }).must_change_password;
      }
      // Allow client-side update() to clear must_change_password after a successful change
      if (trigger === 'update' && session?.must_change_password === false) {
        token.must_change_password = false;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = token.role as UserRole;
        session.user.username = token.username as string;
        session.user.id = token.id as string;
        session.user.must_change_password = token.must_change_password as boolean;
      }
      return session;
    },
  },
  pages: { signIn: '/login' },
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
};
