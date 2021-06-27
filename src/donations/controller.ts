import {requireAuthentication} from '../auth';
import {paypalClient} from './sdk';
import {Request, Response, Router} from 'express';
import {CFToolsClient, DuplicateResourceCreation, ServerApiId, SteamId64} from 'cftools-sdk';
import {AppConfig, Perk} from '../app-config';

const paypal = require('@paypal/checkout-server-sdk');

class CustomId {
    constructor(public readonly steamId: string, public readonly perk: Perk) {
    }

    asString() {
        return `${this.steamId}#${this.perk.id}`
    }

    static fromString(s: string, perks: Perk[]): CustomId | undefined {
        const ids = s.split('#');
        const selectedPerk = perks.find((p) => p.id === parseInt(ids[1]));
        if (!selectedPerk) {
            return;
        }
        return new CustomId(ids[0], selectedPerk);
    }
}

export class DonationController {
    public readonly router: Router = Router();

    constructor(private readonly cftools: CFToolsClient, private readonly config: AppConfig) {
        this.router.post('/donations', requireAuthentication, this.createOrder.bind(this));
        this.router.get('/:orderId', requireAuthentication, this.afterDonation.bind(this));
        this.router.get('/:orderId/redeem', requireAuthentication, this.redeem.bind(this));
        this.router.get('/donations/:orderId', requireAuthentication, this.getOrderDetails.bind(this));
    }

    private async fetchOrderDetails(req: Request, res: Response): Promise<any> {
        const request = new paypal.orders.OrdersGetRequest(req.params.orderId);

        const order = await paypalClient(this.config).execute(request);

        const id = CustomId.fromString(order.result.purchase_units[0].custom_id, this.config.perks);
        const intendedSteamId = id.steamId;
        // @ts-ignore
        const userSteamId = req.user.steam.id;
        if (intendedSteamId !== userSteamId) {
            res.render('payment_steam_mismatch', {
                paymentSteamId: intendedSteamId,
                userSteamId: userSteamId,
            });
            throw Error('steamIdMismatch');
        }
        if (order.result.status !== 'COMPLETED') {
            res.render('index', {
                user: req.user,
                paymentStatus: 'INCOMPLETE',
                redeemStatus: 'UNSTARTED',
            });
            throw new Error('orderNotCompleted');
        }

        return order;
    }

    private async afterDonation(req: Request, res: Response) {
        try {
            const order = await this.fetchOrderDetails(req, res);

            const id = CustomId.fromString(order.result.purchase_units[0].custom_id, this.config.perks);
            if (!id) {
                res.sendStatus(400);
                return;
            }

            res.render('index', {
                user: req.user,
                selectedPerk: id.perk,
                paymentStatus: 'COMPLETE',
                redeemStatus: 'UNSTARTED',
            });
        } catch (err) {
            console.error(err);
            return res.sendStatus(500);
        }
    }

    private async redeem(req: Request, res: Response) {
        try {
            const order = await this.fetchOrderDetails(req, res);
            const id = CustomId.fromString(order.result.purchase_units[0].custom_id, this.config.perks);
            if (!id) {
                res.sendStatus(400);
                return;
            }
            const startTime = new Date(order.result.create_time);
            const expiration = new Date(startTime.valueOf());
            expiration.setDate(startTime.getDate() + id.perk.amountInDays);

            try {
                await this.cftools.putPriorityQueue({
                    serverApiId: ServerApiId.of(id.perk.cftools.serverApiId),
                    id: SteamId64.of(id.steamId),
                    expires: expiration,
                    comment: 'Created by CFTools Server Donation bot'
                });
            } catch (e) {
                if (e instanceof DuplicateResourceCreation) {
                    res.redirect('/');
                    return;
                }
                throw e;
            }

            res.render('index', {
                user: req.user,
                selectedPerk: id.perk,
                paymentStatus: 'COMPLETE',
                redeemStatus: 'COMPLETE',
                priorityUntil: expiration,
            });
        } catch (err) {
            console.error(err);
            return res.send(500);
        }
    }

    private async createOrder(req: Request, res: Response) {
        const selectedPerk = this.config.perks.find((p) => p.id === parseInt(req.body.perkId));
        if (!selectedPerk) {
            res.sendStatus(400);
            return;
        }
        const request = new paypal.orders.OrdersCreateRequest();
        request.prefer('return=representation');
        request.requestBody({
            intent: 'CAPTURE',
            purchase_units: [{
                custom_id: new CustomId(req.body.steamId, selectedPerk).asString(),
                description: selectedPerk.name,
                amount: {
                    currency_code: selectedPerk.price.currency,
                    value: selectedPerk.price.amount
                }
            }]
        });

        try {
            const order = await paypalClient(this.config).execute(request);
            res.status(200).json({
                orderId: order.result.id
            });
        } catch (err) {
            console.error(err);
            return res.sendStatus(500);
        }
    }

    private async getOrderDetails(req: Request, res: Response) {
        const orderID = req.params.orderId;

        const request = new paypal.orders.OrdersCaptureRequest(orderID);
        request.requestBody({});

        try {
            const capture = await paypalClient(this.config).execute(request);
            res.status(200).json({
                orderId: capture.result.id,
            });
        } catch (err) {
            console.error(err);
            return res.sendStatus(500);
        }
    }
}
