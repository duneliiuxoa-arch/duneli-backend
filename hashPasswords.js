import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function hashExistingPasswords() {
    const users = await prisma.user.findMany();
    for (const user of users) {
        if (!user.password.startsWith('$2b$') && !user.password.startsWith('$2a$')) {
            const hashed = await bcrypt.hash(user.password, 10);
            await prisma.user.update({
                where: { id: user.id },
                data: { password: hashed },
            });
            console.log(`Password hashed for user ${user.email}`);
        }
    }
    console.log('All passwords hashed.');
}

hashExistingPasswords()
    .catch(console.error)
    .finally(async() => await prisma.$disconnect());