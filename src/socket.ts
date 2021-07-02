import Socket from 'ws';


export interface KrakenSocketConfig {
    readonly endpoint: string;
    readonly maxReconnectAttempts?: number;
    readonly autoReconnectTimeout?: number;
}

export interface State {
    connected: boolean;
    authed: boolean;
    reconnectAttempts: number;
}

export interface Subscriber {
    symbols: string[];
    cb: (data: any) => void
}

export type TradesChanel = 'trade';
export type OrderbookChannel = 'orderbook';
export type Channels = TradesChanel | OrderbookChannel;

export type AsksAndBids = [string, string, string];

export interface OrderbookWsData {
    readonly a?: AsksAndBids;
    readonly b?: AsksAndBids;
    readonly c: string;
}

export class KrakenSocket {

    private readonly config: KrakenSocketConfig;
    private readonly state: State;
    private socket: Socket;
    private subscribers: {
        orderbook: Subscriber[];
    } = {
            orderbook: []
        };
    private subscribedSymbols: {
        orderbook: string[];
    } = {
            orderbook: []
        };

    private timeouts: {
        reconnectTimeout?: NodeJS.Timeout;
        pingTimeout?: NodeJS.Timeout;
    } = {};

    constructor(config: KrakenSocketConfig) {
        this.config = config;
        this.state = {
            connected: false,
            authed: false,
            reconnectAttempts: 0,
        };
        this.connect();
    }

    private connect(): void {
        const {
            endpoint,
            maxReconnectAttempts,
            autoReconnectTimeout
        } = this.config;

        this.socket = new Socket(endpoint);
        this.socket.on('open', (): void => {
            this.state.connected = true;

            this.pingPong();
            this.handleMessages();
            this.connectChannels();
        });

        this.socket.on('close', (): void => {
            this.state.connected = false;

            console.log(JSON.stringify(this.subscribedSymbols, null, 2));
            console.log(JSON.stringify(this.subscribers, null, 2));


            if (maxReconnectAttempts && this.state.reconnectAttempts > maxReconnectAttempts) return;
            this.state.reconnectAttempts++;

            this.timeouts.reconnectTimeout && clearTimeout(this.timeouts.reconnectTimeout);
            this.timeouts.pingTimeout && clearInterval(this.timeouts.pingTimeout);

            this.connect();
        });

        if (autoReconnectTimeout) {
            const timeout = setTimeout((): void => {
                this.state.connected && this.socket.close();

                this.timeouts.reconnectTimeout = timeout;
                this.timeouts.reconnectTimeout && clearTimeout(this.timeouts.reconnectTimeout);
            }, autoReconnectTimeout);
        }
    }

    private handleMessages(): void {
        if (!this.socket) throw new Error('Web socket not defined');

        this.socket.on('message', (data: Socket.Data): void => {
            const msg = JSON.parse(data.toString());
            switch (msg.event) {
                case 'pong':
                    // console.log('pong message');
                    break;
                case 'heartbeat':
                    // console.log('heartbeat message');
                    break;
                case 'systemStatus':
                    // console.log('system status message');
                    break;
                case 'subscriptionStatus':
                    // console.log('subscriptionStatus message');
                    break;
                default:
                    // console.log(msg);
                    const [channelId, orderbook, chanelName, symbol]: [number, OrderbookWsData, string, string] = msg;
                    try {
                        if (typeof chanelName === 'string') {
                            if (chanelName.startsWith('book')) {
                                for (const { symbols, cb } of this.subscribers.orderbook) {
                                    symbols.includes(symbol) && cb({ ...orderbook, symbol });
                                }
                            }    
                        }
                            
                    } catch (error) {
                        console.log(msg);          
                        // throw error;      
                    }

                    break;
            }
        });
    }

    private pingPong(): void {
        this.socket.on('ping', (): void => {
            this.socket.pong();
        });

        this.socket.on('pong', (): void => {
            this.socket.ping();
        });

        this.timeouts.pingTimeout = setInterval((): void => {
            this.socket.send(this.stringify({ event: 'ping' }));
        }, 2 * 1000);
    }

    public subscribeOrderbook(symbols: string[], cb: (data: OrderbookWsData & {symbol: string;}) => void): boolean {
        if (!symbols.length) return false;
        if (symbols.length > 100) return false;

        this.subscribers.orderbook.push({ symbols, cb });
        this.subscribedSymbols.orderbook.push(...symbols.filter((symbol: string): boolean => {
            return !this.subscribedSymbols.orderbook.includes(symbol);
        }))

        this.state.connected && this.pushOrderbookChannel(symbols.filter((symbol: string): boolean => {
            return !this.subscribedSymbols.orderbook.includes(symbol);
        }));

        return true;
    }

    private connectChannels(): void {
        for (const channel in this.subscribedSymbols) {
            if (Object.prototype.hasOwnProperty.call(this.subscribedSymbols, channel)) {
                const symbols = this.subscribedSymbols[channel];
                switch (channel) {
                    case 'orderbook':
                        this.pushOrderbookChannel(symbols);
                        break;
                    default:
                        throw new Error(`Channel ${channel} not defined`);
                }
            }
        }
    }

    public pushOrderbookChannel(symbols: string[]): void {
        this.socket.send(this.stringify({
            event: 'subscribe',
            pair: symbols,
            subscription: { name: 'book' }
        }));
    }

    private stringify(object: object): string {
        return JSON.stringify(object);
    }
}
