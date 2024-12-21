const express = require('express');
const { createServer } = require('http');
const WebSocket = require('ws');
const dotenv = require('dotenv');
const makeWASocket = require('@adiwajshing/baileys').default;
const { 
    useMultiFileAuthState, 
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeInMemoryStore
} = require('@adiwajshing/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocket.Server({ server });

let client = null;
let qr = null;
const store = makeInMemoryStore({ 
    logger: pino().child({ level: 'silent', stream: 'store' }) 
});

const logger = pino({ level: 'silent' });

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

app.get('/', (req, res) => {
    res.send('ANM Bot Server Running');
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        timestamp: new Date().toISOString(),
        clientActive: client !== null,
        websocketConnections: wss.clients.size
    });
});

const createWhatsAppClient = async () => {
    try {
        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState('baileys_auth');
        
        const sock = makeWASocket({
            version,
            printQRInTerminal: true,
            auth: state,
            logger: pino({ level: 'error' }),
            browser: ['ANM Bot', 'Chrome', '4.0.0'],
            generateHighQualityLinkPreview: true,
            
            // Configuraciones agresivas de conexión
            connectTimeoutMs: 60000, // 1 minuto de timeout
            maxRetries: 5, // Máximo 5 reintentos
            retryRequestDelayMs: 10000, // 10 segundos entre reintentos
            
            // Configuraciones de WebSocket
            socketConfig: {
                keepAlive: true,
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 10000
            }
        });

        // Configurar store
        store.bind(sock.ev);

        sock.ev.on('connection.update', async (update) => {
            console.log('Detalles de conexión completos:', JSON.stringify(update, null, 2));

            const { connection, lastDisconnect, qr: newQr } = update;

            // Manejo específico de QR
            if (newQr) {
                qr = newQr;
                console.log('Nuevo QR generado');
                
                // Broadcast del QR a todos los clientes WebSocket
                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        try {
                            client.send(JSON.stringify({ 
                                type: 'qr', 
                                code: qr 
                            }));
                        } catch (sendError) {
                            console.error('Error enviando QR:', sendError);
                        }
                    }
                });

                // Generar QR en terminal
                qrcode.generate(qr, { small: true });
            }

            // Manejo detallado de desconexiones
            if (connection === 'close') {
                console.error('Conexión cerrada. Detalles:', lastDisconnect?.error);
                
                const shouldReconnect = 
                    lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                
                console.log('¿Debe reconectar?', shouldReconnect);
                
                if (shouldReconnect) {
                    console.log('Intentando reconectar...');
                    // Esperar un poco antes de reconectar
                    setTimeout(async () => {
                        await createWhatsAppClient();
                    }, 10000);
                }
            }

            // Conexión exitosa
            if (connection === 'open') {
                console.log('Cliente WhatsApp conectado exitosamente');
                qr = null;
                wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'ready' }));
                    }
                });
            }
        });

        // Guardar credenciales
        sock.ev.on('creds.update', saveCreds);

        return sock;
    } catch (error) {
        console.error('Error CRÍTICO creando cliente:', error);
        throw error;
    }
};

wss.on('connection', (ws) => {
    console.log('Nueva conexión WebSocket establecida');

    // Enviar QR pendiente si existe
    if (qr) {
        console.log('Enviando QR pendiente');
        ws.send(JSON.stringify({ type: 'qr', code: qr }));
    }

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Mensaje recibido:', data);

            switch (data.type) {
                case 'start':
                    if (!client) {
                        try {
                            client = await createWhatsAppClient();
                            ws.send(JSON.stringify({ type: 'started' }));
                        } catch (startError) {
                            console.error('Error iniciando cliente:', startError);
                            ws.send(JSON.stringify({ 
                                type: 'error', 
                                message: 'No se pudo iniciar el cliente' 
                            }));
                        }
                    }
                    break;

                case 'stop':
                    if (client) {
                        try {
                            await client.logout();
                            client = null;
                            qr = null;
                            ws.send(JSON.stringify({ type: 'stopped' }));
                        } catch (stopError) {
                            console.error('Error deteniendo cliente:', stopError);
                            ws.send(JSON.stringify({ 
                                type: 'error', 
                                message: 'Error deteniendo el cliente' 
                            }));
                        }
                    }
                    break;

                case 'reset':
                    if (client) {
                        try {
                            await client.logout();
                        } catch (resetError) {
                            console.error('Error haciendo logout:', resetError);
                        }
                    }
                    try {
                        client = await createWhatsAppClient();
                        ws.send(JSON.stringify({ type: 'reset' }));
                    } catch (recreateError) {
                        console.error('Error recreando cliente:', recreateError);
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            message: 'No se pudo reiniciar el cliente' 
                        }));
                    }
                    break;

                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;

                case 'getState':
                    if (client && client.user) {
                        ws.send(JSON.stringify({ type: 'ready' }));
                    } else if (qr) {
                        ws.send(JSON.stringify({ type: 'qr', code: qr }));
                    } else {
                        ws.send(JSON.stringify({ type: 'disconnected' }));
                    }
                    break;
            }
        } catch (error) {
            console.error('Error procesando mensaje:', error);
            ws.send(JSON.stringify({ 
                type: 'error', 
                message: error.message 
            }));
        }
    });
});

// Manejo de errores globales
process.on('uncaughtException', (error) => {
    console.error('Error no capturado:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Promesa rechazada:', error);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
