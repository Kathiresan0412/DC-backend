export type AuthTokenPayload = {
    sub: string;
    email: string;
    role: string;
    exp: number;
};
export declare const hashPassword: (password: string) => Promise<string>;
export declare const verifyPassword: (password: string, passwordHash: string) => Promise<boolean>;
export declare const signToken: (payload: Omit<AuthTokenPayload, "exp">) => string;
export declare const verifyToken: (token: string) => AuthTokenPayload;
//# sourceMappingURL=auth.d.ts.map