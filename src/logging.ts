import winston from 'winston';
import {ErrorRequestHandler, NextFunction, Request, Response} from 'express';

export const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.cli(),
    winston.format.errors({stack: true}),
    winston.format.metadata(),
    winston.format.timestamp({
        format: 'YY-MM-DD HH:MM:SS'
    }),
    winston.format.printf((msg) => {
        return `[${msg.timestamp}][${msg.level}] ${msg.message}`;
    })
);

export const log = winston.createLogger({
    transports: [
        new winston.transports.Console({
            format: consoleFormat
        }),
        new winston.transports.File({
            format: winston.format.combine(
                winston.format.metadata()
            ),
            level: 'info',
            filename: 'server.log',
            maxsize: 5 * 1024 * 1024,
            maxFiles: 3,
            tailable: true,
        }),
    ],
});

export const errorHandler: ErrorRequestHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    log.error(err);
    res.render('error', {
        status: err.status || 500,
        supportInfo: JSON.stringify({
            status: err.status || 500,
            selectedPackage: req.session?.selectedPackage?.id,
            user: {
                steamId: req.user?.steam.id,
                discordId: req.user?.discord.id,
            },
            lastOrder: {
                id: req.session?.lastOrder?.id,
                transactionId: req.session?.lastOrder?.transactionId,
            }
        })
    });
};
