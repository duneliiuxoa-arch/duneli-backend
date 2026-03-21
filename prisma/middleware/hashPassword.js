import bcrypt from 'bcrypt';

export async function hashPasswordMiddleware(params, next) {
    // Only hash on User create or update if password field is present
    if (params.model === 'User') {
        if (params.action === 'create' || params.action === 'update') {
            if (params.args.data.password) {
                const hashed = await bcrypt.hash(params.args.data.password, 10);
                params.args.data.password = hashed;
            }
        }
    }
    return next(params);
}