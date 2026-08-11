import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, {type Application} from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import {env} from './env';
import {logger} from './logger';
import {errorMiddleware} from './middlewares/error';
import {router} from './routes/index';

export function createApp(): Application {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: false
    })
  );
  // credentials: true 才能收发 httpOnly 的 refresh_token cookie；开启后 origin 不能为 '*'，必须显式指定前端地址
  app.use(cors({origin: env.CORS_ORIGIN, credentials: true}));
  app.use(compression());
  app.use(express.json({limit: '1mb'}));
  app.use(express.urlencoded({extended: true}));
  app.use(cookieParser());
  app.use(pinoHttp({logger}));

  app.use('/', router);

  app.use((_req, res) => {
    res.status(404).json({error: 'not_found'});
  });

  app.use(errorMiddleware);

  return app;
}
