import {
  Injectable,
  Inject,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import authConfig from '../../../common/config/auth.config';
import { UsersService } from '../../users/users.service';
import { UserRole } from '../../users/enums/user-role.enum';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    @Inject(authConfig.KEY)
    private readonly authCfg: ConfigType<typeof authConfig>,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: authCfg.jwtSecret,
    });
    this.logger.debug(
      `JwtStrategy initialized with secret: ${authCfg.jwtSecret ? 'Present' : 'MISSING'}`,
    );
  }

  async validate(payload: JwtPayload) {
    this.logger.debug(`Validating payload: ${JSON.stringify(payload)}`);
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      this.logger.warn(`User not found for sub: ${payload.sub}`);
      throw new UnauthorizedException();
    }

    if (!user.isVerified) {
      this.logger.warn(`User not verified: ${payload.sub}`);
      throw new ForbiddenException('Email not verified');
    }

    return { id: user.id, email: user.email, role: user.role };
  }
}

