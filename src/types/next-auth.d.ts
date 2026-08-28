import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: 'admin' | 'cliente';
    };
  }

  interface User {
    role?: 'admin' | 'cliente';
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    userId?: number;
    role?: 'admin' | 'cliente';
  }
}
