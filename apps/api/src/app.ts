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
  // 把 pino-http 已经生成的 req.id 通过响应头回传给前端，作为前后端日志关联的唯一
  // id 来源（见 error-monitor-network-support design.md 决策 5：复用现成的 req.id，
  // 不新建一套生成逻辑）。放在 pinoHttp 之后确保 req.id 已生成；放在业务路由/404/
  // errorMiddleware 之前，确保包括非 2xx 响应也都会带上这个头。
  app.use((req, res, next) => {
    res.setHeader('x-trace-id', String(req.id));
    next();
  });

  app.use('/', router);

  app.use((_req, res) => {
    res.status(404).json({error: 'not_found'});
  });

  app.use(errorMiddleware);

  return app;
}
