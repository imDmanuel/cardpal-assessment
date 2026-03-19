import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { UsersService } from '../../modules/users/users.service';

@Injectable()
export class UserActivityInterceptor implements NestInterceptor {
  private readonly logger = new Logger(UserActivityInterceptor.name);

  constructor(private readonly usersService: UsersService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<{
      user?: { id: string };
    }>();
    const user = request.user;

    if (user && user.id) {
      // Fire and forget: Update last active timestamp
      // No 'await' to avoid adding latency to the request
      this.usersService
        .updateLastActive(user.id)
        .catch((err: Error) =>
          this.logger.error(
            `Failed to update last active for user ${user.id}: ${err.message}`,
          ),
        );
    }

    return next.handle();
  }
}

