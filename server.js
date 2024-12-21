const express = require('express');
const { createServer } = require('http');
const WebSocket = require('ws');
const dotenv = require('dotenv');
const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode');

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocket.Server({ server });

let client = null;
let qr = null;

// Configurar CORS para permitir acceso desde la app de Flutter
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Servir archivos estáticos para el QR
app.use(express.static('public'));

// Ruta principal
app.get('/', (req, res) => {
    res.send('ANM Bot Server Running');
});

// Ruta para obtener el QR como imagen
app.get('/qr', async (req, res) => {
    if (qr) {
        try {
            const qrDataURL = await qrcode.toDataURL(qr);
            res.type('png');
            res.send(Buffer.from(qrDataURL.split(',')[1], 'base64'));
        } catch (error) {
            res.status(500).send('Error generando QR');
        }
    } else {
        res.status(404).send('QR no disponible');
    }
});

// Ruta de health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        timestamp: new Date().toISOString(),
        clientActive: client !== null,
        websocketConnections: wss.clients.size,
        qrAvailable: qr !== null
    });
});

const createWhatsAppClient = () => {
    const client = new Client({
        puppeteer: {
            headless: true,
            executablePath: process.env.CHROME_BIN || '/usr/bin/chromium',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-extensions',
                '--single-process',
                '--no-zygote'
            ]
        }
    });

    client.on('qr', async (code) => {
        qr = code;
        console.log('Nuevo código QR generado');
        // Generar QR como imagen
        try {
            const qrDataURL = await qrcode.toDataURL(code);
            // Notificar a todos los clientes WebSocket
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ 
                        type: 'qr', 
                        code: code,
                        dataURL: qrDataURL 
                    }));
                }
            });
        } catch (error) {
            console.error('Error generando QR:', error);
        }
    });

    client.on('ready', () => {
        console.log('Cliente WhatsApp listo');
        qr = null;
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'ready' }));
            }
        });
    });

    client.on('authenticated', () => {
        console.log('Cliente autenticado');
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'authenticated' }));
            }
        });
    });

    client.on('disconnected', async (reason) => {
        console.log('Cliente WhatsApp desconectado:', reason);
        qr = null;
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ 
                    type: 'disconnected',
                    reason: reason 
                }));
            }
        });
        
        if (client) {
            await client.destroy();
            client = null;
        }
    });

    return client;
};

wss.on('connection', (ws) => {
    console.log('Nueva conexión WebSocket establecida');

    if (qr) {
        qrcode.toDataURL(qr)
            .then(dataURL => {
                ws.send(JSON.stringify({ 
                    type: 'qr', 
                    code: qr,
                    dataURL: dataURL 
                }));
            })
            .catch(error => console.error('Error enviando QR:', error));
    }

    if (client && client.info) {
        ws.send(JSON.stringify({ type: 'ready' }));
    }

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Mensaje recibido:', data);

            switch (data.type) {
                case 'start':
                    if (!client) {
                        client = createWhatsAppClient();
                        await client.initialize();
                    }
                    break;

                case 'stop':
                    if (client) {
                        await client.destroy();
                        client = null;
                        qr = null;
                    }
                    break;

                case 'reset':
                    if (client) {
                        await client.destroy();
                    }
                    client = createWhatsAppClient();
                    await client.initialize();
                    break;

                case 'getState':
                    if (client && client.info) {
                        ws.send(JSON.stringify({ type: 'ready' }));
                    } else if (qr) {
                        const dataURL = await qrcode.toDataURL(qr);
                        ws.send(JSON.stringify({ 
                            type: 'qr', 
                            code: qr,
                            dataURL: dataURL 
                        }));
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

    ws.on('close', () => {
        console.log('Cliente WebSocket desconectado');
    });

    ws.on('error', (error) => {
        console.error('Error en WebSocket:', error);
    });
});

process.on('uncaughtException', (error) => {
    console.error('Error no capturado:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Promesa rechazada no manejada:', error);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
