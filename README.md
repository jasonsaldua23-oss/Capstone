# LogiTrack Pro - Logistics Management System

A comprehensive full-stack Logistics Management System with Delivery Tracking, Route Optimization, and Customer Feedback Portal. Built as a capstone-level project with professional, modern, and scalable architecture.

## 🚀 Features

### Three Integrated Interfaces

1. **Admin/Desktop Web App** - Complete management dashboard
2. **Driver Mobile Web App** - Mobile-first delivery interface
3. **Customer Portal** - Client-facing order tracking and feedback

### Core Modules

- **Order Fulfillment** - Create, manage, and track orders through complete lifecycle
- **Transportation Management** - Manage vehicles, drivers, trips, and dispatch
- **Warehousing** - Warehouse and storage location management
- **Inventory Management** - Stock tracking, adjustments, and low-stock alerts
- **Reverse Logistics** - Returns processing and disposition
- **Delivery Tracking** - Real-time GPS tracking with Leaflet maps
- **Route Optimization** - Efficient stop sequencing
- **Customer Feedback** - Ratings, comments, and complaint management
- **Reports & Analytics** - Dashboard KPIs and performance metrics
- **User Management** - Role-based access control (RBAC)

## 🛠 Tech Stack

### Frontend
- **Next.js 15** with App Router
- **React 19** + TypeScript
- **Tailwind CSS** for styling
- **shadcn/ui** component library
- **Recharts** for data visualization
- **React Query** for data fetching

### Backend
- **Next.js API Routes**
- **Prisma ORM** with SQLite (easily switchable to MySQL)
- **JWT Authentication** with jose library
- **bcryptjs** for password hashing

### Maps & Tracking
- **Leaflet** (ready for integration)
- **OpenStreetMap** tiles
- Browser Geolocation API

## 📊 Database Schema

The system includes 20+ interconnected tables:

- **User Management**: `Role`, `User`, `Customer`
- **Warehouse**: `Warehouse`, `StorageLocation`
- **Products**: `ProductCategory`, `Product`, `Inventory`, `InventoryTransaction`
- **Orders**: `Order`, `OrderItem`
- **Transportation**: `Vehicle`, `Driver`, `DriverVehicle`, `Trip`, `TripStop`, `LocationLog`
- **Returns**: `Return`
- **Feedback**: `Feedback`
- **System**: `AuditLog`, `Notification`

## 🚦 Getting Started

### Prerequisites
- Node.js 18+
- Bun (recommended) or npm

### Installation

1. Clone the repository
```bash
git clone <repository-url>
cd logistics-management-system
```

2. Install dependencies
```bash
bun install
```

3. Set up environment variables
```bash
cp .env.example .env
```

4. Generate Prisma client and push schema
```bash
bunx prisma generate
bunx prisma db push
```

5. Seed the database with sample data
```bash
bun run prisma/seed.ts
```

6. Start the development server
```bash
bun run dev
```

The application will be available at `http://localhost:3000`

## Django Backend Mode (No Frontend Code Changes)

This project is configured so all frontend `/api/*` calls are routed to Django.

1. Start Django backend on port `8000`:
```bash
cd backend
set DJANGO_USE_SQLITE=1
python manage.py migrate
python manage.py shell -c "from core.views_api import ensure_demo_accounts; ensure_demo_accounts(); print('ok')"
python manage.py runserver 0.0.0.0:8000
```

2. In project root `.env`, set Django API origin:
```bash
DJANGO_API_ORIGIN=http://127.0.0.1:8000
```

3. Restart Next.js dev server:
```bash
npm run dev
```

4. Verify in browser/API:
- `GET http://localhost:3000/api/health` should return Django response.
- Existing frontend screens continue using `/api/*` unchanged.

## 👥 Test Accounts

### Admin Portal
- **Email**: admin@logistics.com
- **Password**: admin123

### Driver Portal
- **Email**: driver@logistics.com
- **Password**: driver123

### Customer Portal
- **Email**: customer@example.com
- **Password**: customer123

## 📁 Project Structure

```
/src
├── app/                      # Next.js App Router
│   ├── api/                  # API Routes
│   │   ├── auth/            # Authentication endpoints
│   │   ├── dashboard/       # Dashboard stats
│   │   ├── orders/          # Order management
│   │   ├── trips/           # Trip management
│   │   ├── vehicles/        # Vehicle management
│   │   ├── drivers/         # Driver management
│   │   ├── warehouses/      # Warehouse management
│   │   ├── inventory/       # Inventory management
│   │   ├── feedback/        # Customer feedback
│   │   ├── customer/        # Customer-specific endpoints
│   │   └── driver/          # Driver-specific endpoints
│   ├── layout.tsx           # Root layout
│   └── page.tsx             # Main application entry
├── components/
│   ├── ui/                  # shadcn/ui components
│   ├── portals/             # Portal components
│   │   ├── AdminPortal.tsx  # Admin dashboard
│   │   ├── DriverPortal.tsx # Driver mobile app
│   │   ├── CustomerPortal.tsx # Customer portal
│   │   └── LandingPage.tsx  # Landing page with login
│   └── shared/              # Shared components
├── lib/
│   ├── db.ts               # Prisma client
│   ├── auth.ts             # Authentication utilities
│   └── utils.ts            # Helper functions
├── hooks/                   # Custom React hooks
└── types/                   # TypeScript type definitions
/prisma
├── schema.prisma           # Database schema
└── seed.ts                 # Database seed script
```

## 🔐 User Roles & Permissions

### Super Admin
- Full system access
- Manage all users and roles
- Configure system settings
- Access all reports

### Admin / Operations Staff
- Manage orders and deliveries
- Assign drivers and vehicles
- Monitor live deliveries
- View and generate reports

### Warehouse Staff
- Manage warehouse inventory
- Receive and release goods
- Update storage information

### Delivery Driver
- View assigned trips
- Update delivery status
- Share live location
- Upload proof of delivery

### Customer
- Track orders and deliveries
- Submit feedback and ratings
- View order history

## 📱 Interface Features

### Admin Portal
- Dashboard with KPI cards
- Orders management table
- Trips & deliveries tracking
- Vehicles and drivers management
- Warehouses and inventory
- Returns processing
- Live tracking map
- Feedback management
- Reports & analytics
- User management

### Driver Portal (Mobile-First)
- Assigned deliveries list
- Trip details with route
- Stop management
- Status updates
- Proof of delivery upload
- Live location sharing
- Delivery history

### Customer Portal
- Order dashboard
- Order tracking
- Delivery timeline
- Feedback submission
- Order history
- Profile management

## 🔧 API Endpoints

### Authentication
- `POST /api/auth/login` - Staff login
- `POST /api/auth/customer/login` - Customer login
- `POST /api/auth/register` - Customer registration
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Orders
- `GET /api/orders` - List orders
- `POST /api/orders` - Create order

### Trips
- `GET /api/trips` - List trips
- `POST /api/trips` - Create trip

### Vehicles
- `GET /api/vehicles` - List vehicles
- `POST /api/vehicles` - Create vehicle

### Drivers
- `GET /api/drivers` - List drivers
- `POST /api/drivers` - Create driver

### Inventory
- `GET /api/inventory` - List inventory

### Feedback
- `GET /api/feedback` - List feedback
- `POST /api/feedback` - Submit feedback

### Dashboard
- `GET /api/dashboard/stats` - Get statistics

## 🗺 Map Integration

The system is designed to use:
- **Leaflet** for map rendering
- **OpenStreetMap** for map tiles
- **OSRM API** for route optimization
- Browser **Geolocation API** for driver tracking

## 📈 Order Status Flow

```
PENDING → CONFIRMED → PROCESSING → READY_FOR_PICKUP → IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED
                                                                      ↘ FAILED_DELIVERY
                                                                      ↘ RETURNED
```

## 🚛 Trip Status Flow

```
PLANNED → IN_PROGRESS → COMPLETED
         ↘ CANCELLED
```

## 🔄 Future Enhancements

- Real-time WebSocket updates with Socket.IO
- Advanced route optimization with OSRM
- Push notifications
- Mobile app (React Native)
- Integration with external GPS devices
- Advanced analytics dashboard
- Multi-language support
- Email/SMS notifications

## 📄 License

This project is created as a capstone demonstration for educational purposes.

## 🤝 Contributing

This is a demonstration project. For production use, additional security measures, testing, and optimizations should be implemented.

---

Built with ❤️ using Next.js, Prisma, and modern web technologies.
