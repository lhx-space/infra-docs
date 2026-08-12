export {ConsoleReporter} from './core/console-reporter';
export type {InitErrorMonitorOptions} from './core/init';
export {
  configureErrorMonitorNoiseControl,
  initErrorMonitor,
  setErrorMonitorUser
} from './core/init';
export type {ReportErrorOptions} from './core/report-error';
export {reportError} from './core/report-error';
export type {
  BeforeSendHook,
  DedupeOptions,
  ErrorLevel,
  ErrorReport,
  ErrorSource,
  Reporter,
  ThrottleOptions
} from './core/types';
