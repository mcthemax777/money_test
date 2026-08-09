import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import { PrismaService } from '../../config/prisma.service';
import { RedisService } from '../../config/redis.service';
import { ConfigService } from '../../config/config.service';
import { Auth } from '@money/types';
import * as bcrypt from 'bcryptjs';

interface TokenPayload {
  sub: string;
  type: 'access' | 'refresh';
  exp?: number;
}

const BLACKLIST_PREFIX = 'token:blacklist:';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
  ) {}

  async signUp(dto: Auth.SignUpRequest): Promise<Auth.AuthResponse> {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new BadRequestException('Email already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        password: hashedPassword,
      },
    });

    return {
      ...this.generateTokens(user.id),
      user: this.toUserResponse(user),
    };
  }

  async signIn(dto: Auth.SignInRequest): Promise<Auth.AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return {
      ...this.generateTokens(user.id),
      user: this.toUserResponse(user),
    };
  }

  async refresh(dto: Auth.RefreshRequest): Promise<Auth.AuthResponse> {
    let payload: TokenPayload;
    try {
      payload = this.jwtService.verify<TokenPayload>(dto.refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (await this.isTokenBlacklisted(dto.refreshToken)) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.validateUser(payload.sub);

    // rotation: 사용한 refreshToken은 재사용 불가
    await this.blacklistToken(dto.refreshToken);

    return {
      ...this.generateTokens(user.id),
      user: this.toUserResponse(user),
    };
  }

  async logout(accessToken: string, refreshToken?: string): Promise<{ success: boolean }> {
    await this.blacklistToken(accessToken);
    if (refreshToken) {
      await this.blacklistToken(refreshToken);
    }
    return { success: true };
  }

  async isTokenBlacklisted(token: string): Promise<boolean> {
    return this.redis.exists(BLACKLIST_PREFIX + this.hashToken(token));
  }

  async validateUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  private generateTokens(userId: string) {
    const accessToken = this.jwtService.sign(
      { sub: userId, type: 'access' },
      { expiresIn: this.configService.jwtExpiresIn },
    );
    const refreshToken = this.jwtService.sign(
      { sub: userId, type: 'refresh' },
      { expiresIn: this.configService.refreshTokenExpiresIn },
    );

    return { accessToken, refreshToken };
  }

  private async blacklistToken(token: string): Promise<void> {
    const decoded = this.jwtService.decode(token) as TokenPayload | null;
    if (!decoded?.exp) {
      return;
    }

    const remainingSeconds = decoded.exp - Math.floor(Date.now() / 1000);
    if (remainingSeconds <= 0) {
      return;
    }

    await this.redis.setWithTtl(
      BLACKLIST_PREFIX + this.hashToken(token),
      '1',
      remainingSeconds,
    );
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toUserResponse(user: {
    id: string;
    email: string;
    name: string;
    avatar: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
