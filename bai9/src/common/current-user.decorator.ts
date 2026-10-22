import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

// Gia lap xac thuc: userId lay tu header X-User-Id (thuc te lay tu JWT da xac minh).
// Khoa cache du lieu rieng chi duoc tao tu gia tri nay, khong bao gio tu tham so client tu dat.
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): number => {
  const header = ctx.switchToHttp().getRequest<Request>().header('x-user-id');
  const userId = Number(header);
  if (!header || !Number.isInteger(userId) || userId < 1) {
    throw new UnauthorizedException('Missing or invalid X-User-Id');
  }
  return userId;
});
