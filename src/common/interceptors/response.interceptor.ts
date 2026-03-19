import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Response } from 'express';

export interface ResponseFormat<T> {
  success: boolean;
  statusCode: number;
  message?: string;
  data?: T;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ResponseFormat<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ResponseFormat<T>> {
    const httpContext = context.switchToHttp();
    const response = httpContext.getResponse<Response>();

    return next.handle().pipe(
      map((data: unknown) => {
        let message: string | undefined;
        let finalData = data;

        // Extract message if present in an object
        if (data && typeof data === 'object' && 'message' in data) {
          const dataObj = data as Record<string, unknown>;
          message = dataObj.message as string;
          const { message: _unused, ...remainingData } = dataObj; // eslint-disable-line @typescript-eslint/no-unused-vars
          finalData = remainingData;
        }

        // Determine if data should be omitted
        const hasData =
          finalData !== null &&
          finalData !== undefined &&
          (typeof finalData !== 'object' || Object.keys(finalData).length > 0);

        return {
          success: true,
          statusCode: response.statusCode,
          ...(message ? { message } : {}),
          ...(hasData ? { data: finalData as T } : {}),
        };
      }),
    );
  }
}

