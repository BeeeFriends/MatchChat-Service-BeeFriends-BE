import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, map } from 'rxjs';

type ApiSuccessResponse<T> = {
  success: true;
  message: string;
  data: T | null;
};

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiSuccessResponse<T> | T
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T> | T> {
    const request = context.switchToHttp().getRequest<Request>();

    if (this.isHealthCheck(request)) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        if (this.isWrappedResponse(data)) return data;

        return {
          success: true,
          message: 'Success',
          data: data ?? null,
        };
      }),
    );
  }

  private isWrappedResponse(data: unknown): data is T {
    return (
      typeof data === 'object' &&
      data !== null &&
      'success' in data &&
      typeof data.success === 'boolean'
    );
  }

  private isHealthCheck(request: Request) {
    return request.path.endsWith('/health') || request.url.endsWith('/health');
  }
}
