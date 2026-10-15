import { randomUUID } from 'crypto';
import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../config/prisma.service';
import { ConfigService } from '../../config/config.service';
import { UsersService } from '../users/users.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { OAuth2Client, type TokenPayload as GoogleTokenPayload } from 'google-auth-library';
import { asWeekStart, Auth, DEFAULT_LOCALE, isLocale } from '@money/types';

interface TokenPayload {
  sub: string;
  type: 'access' | 'refresh';
  exp?: number;
  /** 갱신 토큰의 id. RefreshToken 행의 열쇠다. 이 칸이 생기기 전에 나간 토큰에는 없다. */
  jti?: string;
}

/**
 * 교체된 갱신 토큰을 다시 받아 주는 동안(ms). 웹 탭 둘이 같은 쿠키로 함께 갱신하면 늦게 온 쪽이
 * 방금 교체된 토큰을 든다 -- 그것까지 훔친 것으로 보면 멀쩡한 사람이 로그아웃된다.
 */
const ROTATION_GRACE_MS = 60_000;


@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly projectAccess: ProjectAccessService,
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
      // 이메일과 사진은 구글 쪽 변경을 따라간다.
      // 이름은 사용자가 프로필에서 직접 바꿀 수 있으므로 덮어쓰지 않는다.
      // 덮어쓰면 로그인할 때마다 구글 이름으로 되돌아간다.
      const user = await this.prisma.user.update({
        where: { id: existing.id },
        data: { email, avatar },
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
    /*
     * 만든 행을 그대로 돌려준다. 예전에는 기본 가계부를 만들어 붙이느라 id 만 들고
     * 있다가 다시 읽었는데, 이제 그 걸음이 없어 처음 읽은 행이 곧 답이다.
     */
    let user: Awaited<ReturnType<typeof this.prisma.user.create>>;
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

    /*
     * **가계부는 만들지 않는다.** 첫 화면에서 사람이 고른다.
     *
     * 예전에는 여기서 "OOO의 프로젝트"를 만들어 주었다. 그러면 남의 가계부에 들어오려고
     * 가입한 사람에게도 제 가계부가 하나 생기고, 그것을 지우는 일이 따로 남는다. 들어온
     * 사람은 대개 그것을 지우지 않아 빈 가계부가 목록에 계속 선다.
     *
     * 가계부가 없는 사람은 시작 화면으로 간다 (웹 `/start`, 앱의 StartScreen).
     * 거기서 만들거나, 받은 번호·QR 로 남의 가계부에 들어간다.
     */
    return user;
  }

  private async buildAuthResponse(user: {
    id: string;
    email: string;
    name: string;
    avatar: string | null;
    defaultProjectId: string | null;
    locale: string;
    weekStart: number;
    createdAt: Date;
    updatedAt: Date;
  }, familyId?: string): Promise<Auth.AuthResponse> {
    // user.defaultProjectId를 그대로 쓰지 않는다. 삭제된 프로젝트를 가리킬 수
    // 있어서다. 접근 가능한 프로젝트를 다시 해석한다.
    const projectId = await this.projectAccess.findDefaultProjectId(user.id);

    // 프로젝트를 모두 삭제하거나 탈퇴한 사용자도 로그인은 되어야 한다.
    // 막으면 프로젝트를 새로 만들 방법이 없어 계정이 잠긴다.
    const defaultProjectData = projectId
      ? await this.usersService.getUserProjectInitialData(user.id, projectId)
      : null;

    return {
      ...(await this.generateTokens(user.id, familyId)),
      user: {
        ...this.toUserResponse(user),
        defaultProjectId: projectId ?? undefined,
      },
      defaultProjectData: defaultProjectData as any,
    };
  }

  /**
   * 갱신. 갱신 토큰은 **한 번 쓰면 교체된다** (2026-10-16).
   *
   * 예전에는 서버가 토큰을 기억하지 않아, 한번 나간 갱신 토큰은 만료(7일) 전까지 끊을 길이 없었다 --
   * 훔친 토큰이 일주일 동안 새 토큰을 찍어 냈다. 이제 토큰마다 행(RefreshToken)을 두고:
   *
   *   살아 있는 토큰      교체됨을 적고 같은 묶음의 새 토큰을 준다.
   *   방금 교체된 토큰    (ROTATION_GRACE_MS 안) 같은 묶음의 새 토큰을 하나 더 준다 -- 탭 둘의 동시 갱신.
   *   오래전 교체된 토큰  재사용이다. 훔친 쪽과 진짜 쪽 중 누가 먼저 썼는지 모르므로 묶음 전체를 끊는다.
   *   끊긴·없는 토큰      401.
   *
   * 이 칸이 생기기 전에 나간 토큰(jti 없음)은 한 번 받아 주고 새 묶음으로 옮긴다 -- 배포하는 순간 모두가
   * 로그아웃되지 않게. 그런 토큰은 길어야 7일 뒤 모두 사라진다.
   */
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

    const user = await this.validateUser(payload.sub);
    if (!payload.jti) return this.buildAuthResponse(user);

    const issued = await this.prisma.refreshToken.findUnique({ where: { id: payload.jti } });
    if (!issued || issued.userId !== user.id || issued.revokedAt) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (issued.rotatedAt) {
      if (Date.now() - issued.rotatedAt.getTime() > ROTATION_GRACE_MS) {
        await this.revokeFamily(issued.familyId);
        throw new UnauthorizedException('Invalid refresh token');
      }
      return this.buildAuthResponse(user, issued.familyId);
    }

    // 먼저 교체됨을 적는다. 같은 토큰으로 겹친 두 요청 중 하나만 "살아 있는 토큰" 길로 간다.
    await this.prisma.refreshToken.updateMany({
      where: { id: issued.id, rotatedAt: null },
      data: { rotatedAt: new Date() },
    });
    return this.buildAuthResponse(user, issued.familyId);
  }

  /**
   * 로그아웃. 그 기기의 갱신 토큰 묶음을 끊는다 -- 다른 기기의 로그인은 그대로다.
   *
   * 남은 액세스 토큰은 짧은 만료(JWT_EXPIRES_IN)로 곧 죽는다. 갱신 토큰을 싣지 않았거나 읽을 수 없으면
   * 끊을 것이 없을 뿐 실패로 돌려주지 않는다 (클라이언트는 어차피 토큰을 지운다).
   */
  async logout(userId: string, refreshToken?: string): Promise<{ success: boolean }> {
    if (!refreshToken) return { success: true };
    try {
      const payload = this.jwtService.verify<TokenPayload>(refreshToken);
      if (payload.type !== 'refresh' || payload.sub !== userId || !payload.jti) {
        return { success: true };
      }
      const issued = await this.prisma.refreshToken.findUnique({ where: { id: payload.jti } });
      if (issued && issued.userId === userId) await this.revokeFamily(issued.familyId);
    } catch {
      // 만료됐거나 읽을 수 없는 토큰은 끊을 것이 없다.
    }
    return { success: true };
  }

  /** 한 로그인(묶음)의 갱신 토큰을 모두 끊는다. */
  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
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

  /**
   * 토큰 쌍을 만든다. 갱신 토큰은 행을 남긴다 (refresh 주석). 묶음을 주지 않으면 새 로그인이다.
   *
   * 만들 때마다 이 사람의 만료된 행을 치운다 -- 사람마다 기기 수만큼만 남는다.
   */
  private async generateTokens(userId: string, familyId?: string) {
    const accessToken = this.jwtService.sign(
      { sub: userId, type: 'access' },
      { expiresIn: this.configService.jwtExpiresIn },
    );
    const jti = randomUUID();
    const refreshToken = this.jwtService.sign(
      { sub: userId, type: 'refresh', jti },
      { expiresIn: this.configService.refreshTokenExpiresIn },
    );
    const { exp } = this.jwtService.decode(refreshToken) as { exp: number };

    await this.prisma.refreshToken.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
    await this.prisma.refreshToken.create({
      data: {
        id: jti,
        userId,
        familyId: familyId ?? randomUUID(),
        expiresAt: new Date(exp * 1000),
      },
    });

    return { accessToken, refreshToken };
  }



  private toUserResponse(user: {
    id: string;
    email: string;
    name: string;
    avatar: string | null;
    locale: string;
    weekStart: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      // locale 컬럼은 TEXT다. 지원하지 않는 값이 남아 있어도(언어를 뺀 뒤 등)
      // 화면이 빈 사전을 들고 깨지지 않도록 기본값으로 되돌린다.
      locale: isLocale(user.locale) ? user.locale : DEFAULT_LOCALE,
      // 시작 요일도 같은 까닭으로 한 번 거른다. 컬럼이 INTEGER라 범위 밖 값이
      // 남아 있어도 달력이 첫 줄을 엉뚱하게 메우지 않는다.
      weekStart: asWeekStart(user.weekStart),
      // 와이어 계약은 ISO 문자열이다 (IsoDateString)
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}
