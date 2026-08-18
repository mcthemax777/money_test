import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import { PrismaService } from '../../config/prisma.service';
import { RedisService } from '../../config/redis.service';
import { ConfigService } from '../../config/config.service';
import { UsersService } from '../users/users.service';
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
    private readonly usersService: UsersService,
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

    const defaultProject = await this.createDefaultProject(user.id);

    // 기본 프로젝트 설정
    await this.prisma.user.update({
      where: { id: user.id },
      data: { defaultProjectId: defaultProject.id },
    });

    const defaultProjectData = await this.usersService.getUserProjectInitialData(user.id, defaultProject.id);

    return {
      ...this.generateTokens(user.id),
      user: {
        ...this.toUserResponse(user),
        defaultProjectId: defaultProject.id,
      },
      defaultProjectData: defaultProjectData as any,
    };
  }

  private async createDefaultProject(userId: string) {
    const project = await this.prisma.project.create({
      data: {
        name: '나의 프로젝트',
        description: '첫 번째 프로젝트',
      },
    });

    await this.prisma.projectMember.create({
      data: {
        projectId: project.id,
        userId,
        role: 'owner',
      },
    });

    // 기본 사용자(본인) 생성
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    await this.prisma.person.create({
      data: {
        projectId: project.id,
        userId,
        name: user!.name,
      },
    });

    await this.createDefaultCategories(userId, project.id);

    return project;
  }

  private async createDefaultCategories(userId: string, projectId: string): Promise<void> {
    const defaultCategories = [
      {
        type: 'income',
        main: ['급여', '상여금', '이자/배당금', '기타수입'],
      },
      {
        type: 'expense',
        main: [
          '식료품',
          '외식',
          '교통',
          '통신',
          '공과금',
          '교육',
          '의료',
          '쇼핑',
          '엔터테인먼트',
          '저축',
        ],
      },
    ];

    for (const category of defaultCategories) {
      for (const name of category.main) {
        await this.prisma.category.create({
          data: {
            projectId,
            userId,
            name,
            type: category.type,
            level: 1,
          },
        });
      }
    }
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

    const defaultProjectData = await this.usersService.getUserProjectInitialData(user.id);

    return {
      ...this.generateTokens(user.id),
      user: {
        ...this.toUserResponse(user),
        defaultProjectId: user.defaultProjectId || undefined,
      },
      defaultProjectData: defaultProjectData as any,
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

    const defaultProjectData = await this.usersService.getUserProjectInitialData(user.id);

    return {
      ...this.generateTokens(user.id),
      user: {
        ...this.toUserResponse(user),
        defaultProjectId: user.defaultProjectId || undefined,
      },
      defaultProjectData: defaultProjectData as any,
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
