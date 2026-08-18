import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import { PrismaService } from '../../config/prisma.service';
import { RedisService } from '../../config/redis.service';
import { ConfigService } from '../../config/config.service';
import { UsersService } from '../users/users.service';
import { ProjectsService } from '../projects/projects.service';
import { OAuth2Client, type TokenPayload as GoogleTokenPayload } from 'google-auth-library';
import { Auth } from '@money/types';

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
    private readonly projectsService: ProjectsService,
  ) {}

  // ID 토큰 검증만 수행하므로 client secret은 필요하지 않다.
  private readonly googleClient = new OAuth2Client();

  async signInWithGoogle(dto: Auth.GoogleSignInRequest): Promise<Auth.AuthResponse> {
    const payload = await this.verifyGoogleIdToken(dto.idToken);

    const googleId = payload.sub;
    const email = payload.email!.toLowerCase();
    // 구글 계정에 이름이 없을 수 있으므로 이메일 앞부분으로 대체한다.
    const name = payload.name?.trim() || email.split('@')[0];
    const avatar = payload.picture ?? null;

    const existing = await this.prisma.user.findUnique({ where: { googleId } });

    if (existing) {
      // 이메일, 이름, 사진은 구글 쪽에서 변경될 수 있으므로 로그인마다 최신화한다.
      const user = await this.prisma.user.update({
        where: { id: existing.id },
        data: { email, name, avatar },
      });

      return this.buildAuthResponse(user);
    }

    const user = await this.createGoogleUser({ googleId, email, name, avatar });

    return this.buildAuthResponse(user);
  }

  private async verifyGoogleIdToken(idToken: string): Promise<GoogleTokenPayload> {
    if (!idToken) {
      throw new BadRequestException('idToken이 필요합니다.');
    }

    // try 밖에서 읽는다. 안에서 읽으면 설정 누락이 토큰 오류로 뭉개져
    // 운영 중 원인을 찾기 어려워진다.
    const audience = this.configService.googleClientIds;

    let payload: GoogleTokenPayload | undefined;
    try {
      // audience에 클라이언트 ID 목록을 넘기면 aud, iss, 서명, 만료를 함께 검증한다.
      const ticket = await this.googleClient.verifyIdToken({ idToken, audience });
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('유효하지 않은 구글 토큰입니다.');
    }

    if (!payload?.sub || !payload.email) {
      throw new UnauthorizedException('구글 토큰에 필요한 정보가 없습니다.');
    }

    // 미인증 이메일을 신뢰하면 타인의 이메일을 주장하는 토큰으로 계정을 만들 수 있다.
    if (payload.email_verified !== true) {
      throw new UnauthorizedException('이메일이 인증되지 않은 구글 계정입니다.');
    }

    return payload;
  }

  private async createGoogleUser(data: {
    googleId: string;
    email: string;
    name: string;
    avatar: string | null;
  }) {
    let user: { id: string };
    try {
      user = await this.prisma.user.create({ data });
    } catch (error) {
      // 동시 최초 로그인으로 googleId 또는 email unique 제약이 충돌한 경우,
      // 이미 만들어진 계정으로 이어간다.
      if ((error as { code?: string }).code === 'P2002') {
        const created = await this.prisma.user.findUnique({
          where: { googleId: data.googleId },
        });

        if (!created) {
          // googleId가 아니라 email이 충돌한 경우. 다른 구글 계정이 같은 이메일을
          // 선점하고 있어 연결할 수 없다.
          throw new BadRequestException('이미 사용 중인 이메일입니다.');
        }

        return created;
      }

      throw error;
    }

    const defaultProject = await this.createDefaultProject(user.id);

    return this.prisma.user.update({
      where: { id: user.id },
      data: { defaultProjectId: defaultProject.id },
    });
  }

  private async buildAuthResponse(user: {
    id: string;
    email: string;
    name: string;
    avatar: string | null;
    defaultProjectId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): Promise<Auth.AuthResponse> {
    const defaultProjectData = await this.usersService.getUserProjectInitialData(
      user.id,
      user.defaultProjectId ?? undefined,
    );

    return {
      ...this.generateTokens(user.id),
      user: {
        ...this.toUserResponse(user),
        defaultProjectId: user.defaultProjectId || undefined,
      },
      defaultProjectData: defaultProjectData as any,
    };
  }

  private async createDefaultProject(userId: string) {
    const project = await this.prisma.project.create({
      data: {
        name: '나의 프로젝트',
        description: '첫 번째 프로젝트',
        // 다른 사용자가 검색해 가입 요청할 수 있도록 키를 함께 발급한다.
        projectKey: await this.projectsService.issueProjectKey(),
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

    return this.buildAuthResponse(user);
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
