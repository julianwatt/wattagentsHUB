import 'next-auth';
import 'next-auth/jwt';

export type UserRole = 'agent' | 'jr_manager' | 'sr_manager' | 'admin' | 'ceo';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      username: string;
      role: UserRole;
      must_change_password: boolean;
    };
  }
  interface User {
    role: UserRole;
    username: string;
    must_change_password: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role: UserRole;
    username: string;
    id: string;
    must_change_password: boolean;
  }
}
