import {Router} from 'express';
import {loginHandler, logoutHandler, refreshHandler, registerHandler} from '../handlers/auth';
import {loginRateLimiter, registerRateLimiter} from '../middlewares/rate-limit';

export const authRouter = Router();

authRouter.post('/register', registerRateLimiter, registerHandler);
authRouter.post('/login', loginRateLimiter, loginHandler);
authRouter.post('/refresh', refreshHandler);
authRouter.post('/logout', logoutHandler);
