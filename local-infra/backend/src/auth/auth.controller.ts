import { Body, Controller, Post } from '@nestjs/common';
import { LoginDto } from './dto/login.dto';
import { PrismaClient } from '@prisma/client';
import * as jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

@Controller('auth')
export class AuthController {
  @Post('login')
  async login(@Body() dto: LoginDto) {
    const user = await prisma.user.upsert({
      where: { email: dto.email },
      update: {},
      create: { email: dto.email },
    });
    const token = jwt.sign(
      { sub: user.id, email: user.email },
      process.env.JWT_SECRET || 'dev',
      { expiresIn: '7d' },
    );
    return { token, user: { id: user.id, email: user.email } };
  }
}
