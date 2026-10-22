import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`ShopFast API: http://localhost:${port}`);
}

// Luoi an toan cuoi cung: loi bat dong bo bi bo sot chi duoc ghi log, khong lam sap tien trinh
const logger = new Logger('Process');
process.on('unhandledRejection', (reason) => logger.error(`Unhandled rejection: ${String(reason)}`));

bootstrap();
