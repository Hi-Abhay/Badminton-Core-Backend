const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Badminton App API',
      version: '1.0.0',
      description: 'API documentation for Badminton player matchmaking and connections',
    },
    servers: [
      {
        url: 'http://localhost:5001',
        description: 'Local development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', example: '652f1b8a9c1e2b001a4e5f61' },
            fullName: { type: 'string', example: 'Alex Smith' },
            email: { type: 'string', example: 'alex@example.com' },
            role: { type: 'string', enum: ['single', 'double'], example: 'single' },
            profile_image: { type: 'string', nullable: true, example: 'https://example.com/avatar.jpg' },
            totalMatch: { type: 'number', example: 10 },
            winMatch: { type: 'number', example: 7 },
          },
        },
        Connection: {
          type: 'object',
          properties: {
            _id: { type: 'string', example: '652f1c3d9c1e2b001a4e5f62' },
            requester: { type: 'string', example: '652f1b8a9c1e2b001a4e5f61' },
            recipient: { type: 'string', example: '652f1b8a9c1e2b001a4e5f62' },
            status: { type: 'string', enum: ['pending', 'accepted', 'declined'], example: 'pending' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  },
  apis: ['./src/routes/*.js'], // Scans all route files for JSDoc documentation
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;