const core = require('.');
const log = require('./log');

const { ControllerWSContext, ControllerHTTPContext } = require('./context');
const { getController } = require('./utils/loader');
const Session = require('./session');

// TODO: better error reporting
function catchError (ctx, err) {
    if (err instanceof core.HttpError) {
        switch (ctx.type) {
            case 'http':
                ctx.send(err.message, err.code);
                break;
            case 'ws':
                ctx.emit('error', err.message, err.code);
                break;
        }

        core.emitError({
            isSystem: true,
            type: 'DispatchError',
            ...err,
            error: err
        });
    } else {
        switch (ctx.type) {
            case 'http':
                ctx.send(err.toString(), 500);
                break;
            case 'ws':
                ctx.emit('error', err.toString(), 500);
                break;
        }

        if (err._catched) return;
        core.emitError({
            isSystem: true,
            type: 'DispatchError',
            code: 500,
            message: err.message,
            error: err
        });
    }
}

const dispatch = {
    async http (req, res, handler) {
        const ctx = new ControllerHTTPContext(req, res);
        try {
            // TODO: check if session is required for this call through vanilla decorators
            await ctx.init();
        } catch (err) {
            return ctx.send(err.toString(), 500);
        }

        try {
            const result = await handler(ctx);
            if (!res.aborted && result !== undefined) {
                ctx.send(result);
            }
        } catch (err) {
            if (err instanceof core.HttpError) {
                ctx.send(err.message, err.code);
            } else {
                ctx.send(err.toString(), 500);
                return catchError(ctx, err);
            }
        }
    },

    WS_SYSTEM_EVENTS: ['open', 'close', 'error'],
    async ws (ws) {
        let obj = {};
        const controller = getController('Socket');
        const ctx = new ControllerWSContext(ws);

        let initProgress;
        const init = async session => {
            try {
                await ctx.init(session);
            } catch (err) {
                return ctx.emit('error', err.toString(), 500);
            }

            try {
                if (controller.open) await controller.open.call(ctx);
            } catch (err) {
                return catchError(ctx, err);
            }
        };

        if (!Session.enabled) initProgress = init();

        obj.message = async msg => {
            const buf = Buffer.from(msg);
            const str = buf.toString();
            if (Session.enabled) {
                if (str.startsWith('session:')) {
                    initProgress = init(str.slice(8));
                    return;
                }
            }

            if (initProgress) await initProgress;
            try {
                const parsed = JSON.parse(str);
                if (~parsed[0].indexOf(dispatch.WS_SYSTEM_EVENTS)) return;
                if (parsed[0] in controller) {
                    controller[parsed[0]].apply(ctx, parsed.slice(1));
                }
            } catch (err) {
                return catchError(ctx, err);
            }
        }

        obj.error = async (code, msg) => {
            // 0 - Clear close
            // 1001 - Page closed
            // 1006 & !message - Browser ended connection with no close frame.
            //                   In most cases it means "normal" close when page reloaded or browser closed
            if (code != 0 && code != 1000 && code != 1001 && (code != 1006 || msg)) {
                msg = Buffer.from(msg).toString();
                if (ctx) {
                    if (controller.error) {
                        await controller.error.call(ctx, [code, msg]);
                    } else {
                        log.error('Unhandled socket error', `WebSocket disconnected with code ${code}\nDriver message: ${msg}`);
                        core.emitError({
                            isSystem: true,
                            type: 'SocketUnhandledError',
                            code,
                            message: msg
                        });
                    }
                }
            }

            if (ctx) {
                if (controller.close) controller.close.call(ctx);
                ctx._destroy();
            }
        }

        return obj;
    }
};

module.exports = dispatch;
