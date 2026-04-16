import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // Create Roles
  const roles = await Promise.all([
    prisma.role.upsert({
      where: { name: 'SUPER_ADMIN' },
      update: {},
      create: { name: 'SUPER_ADMIN', description: 'Full system access' }
    }),
    prisma.role.upsert({
      where: { name: 'ADMIN' },
      update: {},
      create: { name: 'ADMIN', description: 'Administrative access' }
    }),
    prisma.role.upsert({
      where: { name: 'WAREHOUSE_STAFF' },
      update: {},
      create: { name: 'WAREHOUSE_STAFF', description: 'Warehouse operations' }
    }),
    prisma.role.upsert({
      where: { name: 'DRIVER' },
      update: {},
      create: { name: 'DRIVER', description: 'Delivery driver' }
    }),
  ])

  console.log('Created roles:', roles.length)

  // Create Admin Users
  const hashedPassword = await bcrypt.hash('admin123', 12)
  const driverPassword = await bcrypt.hash('driver123', 12)
  const customerPassword = await bcrypt.hash('customer123', 12)

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@logistics.com' },
    update: {},
    create: {
      email: 'admin@logistics.com',
      name: 'Admin User',
      password: hashedPassword,
      phone: '+1-555-0100',
      roleId: roles.find(r => r.name === 'SUPER_ADMIN')?.id || roles[0].id,
      isActive: true,
    }
  })

  const staffUser = await prisma.user.upsert({
    where: { email: 'staff@logistics.com' },
    update: {},
    create: {
      email: 'staff@logistics.com',
      name: 'Staff Member',
      password: hashedPassword,
      phone: '+1-555-0101',
      roleId: roles.find(r => r.name === 'ADMIN')?.id || roles[1].id,
      isActive: true,
    }
  })

  const warehouseUser = await prisma.user.upsert({
    where: { email: 'warehouse@logistics.com' },
    update: {},
    create: {
      email: 'warehouse@logistics.com',
      name: 'Warehouse Staff',
      password: hashedPassword,
      phone: '+1-555-0102',
      roleId: roles.find(r => r.name === 'WAREHOUSE_STAFF')?.id || roles[2].id,
      isActive: true,
    }
  })

  const driverUser = await prisma.user.upsert({
    where: { email: 'driver@logistics.com' },
    update: {},
    create: {
      email: 'driver@logistics.com',
      name: 'Mike Johnson',
      password: driverPassword,
      phone: '+1-555-0103',
      roleId: roles.find(r => r.name === 'DRIVER')?.id || roles[3].id,
      isActive: true,
    }
  })

  console.log('Created users')

  // Create Customers
  const customer = await prisma.customer.upsert({
    where: { email: 'customer@example.com' },
    update: {},
    create: {
      email: 'customer@example.com',
      name: 'John Smith',
      password: customerPassword,
      phone: '+1-555-0200',
      address: '123 Main Street',
      city: 'New York',
      province: 'NY',
      zipCode: '10001',
      country: 'USA',
      latitude: 40.7128,
      longitude: -74.0060,
      isActive: true,
    }
  })

  const customer2 = await prisma.customer.create({
    data: {
      email: 'jane.doe@example.com',
      name: 'Jane Doe',
      password: customerPassword,
      phone: '+1-555-0201',
      address: '456 Oak Avenue',
      city: 'Los Angeles',
      province: 'CA',
      zipCode: '90001',
      country: 'USA',
      latitude: 34.0522,
      longitude: -118.2437,
      isActive: true,
    }
  })

  console.log('Created customers')

  // Create Warehouses
  const warehouse = await prisma.warehouse.create({
    data: {
      name: 'Main Distribution Center',
      code: 'WH-MAIN',
      address: '1000 Industrial Blvd',
      city: 'Newark',
      province: 'NJ',
      zipCode: '07102',
      country: 'USA',
      latitude: 40.7328,
      longitude: -74.1745,
      capacity: 10000,
    }
  })

  console.log('Created warehouses')

  // Create Product Categories
  const category = await prisma.productCategory.create({
    data: {
      name: 'Electronics',
      description: 'Electronic devices and accessories'
    }
  })

  const category2 = await prisma.productCategory.create({
    data: {
      name: 'Clothing',
      description: 'Apparel and fashion items'
    }
  })

  console.log('Created categories')

  // Create Products
  const product1 = await prisma.product.create({
    data: {
      sku: 'ELEC-001',
      name: 'Wireless Headphones',
      description: 'Premium wireless Bluetooth headphones',
      categoryId: category.id,
      unit: 'piece',
      weight: 0.5,
      dimensions: '20x15x10',
      price: 149.99,
    }
  })

  const product2 = await prisma.product.create({
    data: {
      sku: 'ELEC-002',
      name: 'Smartphone Case',
      description: 'Protective case for smartphones',
      categoryId: category.id,
      unit: 'piece',
      weight: 0.1,
      price: 29.99,
    }
  })

  const product3 = await prisma.product.create({
    data: {
      sku: 'CLTH-001',
      name: 'Cotton T-Shirt',
      description: '100% cotton t-shirt',
      categoryId: category2.id,
      unit: 'piece',
      weight: 0.2,
      price: 24.99,
    }
  })

  const product4 = await prisma.product.create({
    data: {
      sku: 'CLTH-002',
      name: 'Denim Jeans',
      description: 'Classic blue denim jeans',
      categoryId: category2.id,
      unit: 'piece',
      weight: 0.5,
      price: 59.99,
    }
  })

  console.log('Created products')

  // Create Inventory
  await prisma.inventory.createMany({
    data: [
      { productId: product1.id, warehouseId: warehouse.id, quantity: 150, minStock: 20, maxStock: 200, reorderPoint: 30 },
      { productId: product2.id, warehouseId: warehouse.id, quantity: 500, minStock: 50, maxStock: 1000, reorderPoint: 100 },
      { productId: product3.id, warehouseId: warehouse.id, quantity: 300, minStock: 30, maxStock: 500, reorderPoint: 50 },
      { productId: product4.id, warehouseId: warehouse.id, quantity: 200, minStock: 20, maxStock: 300, reorderPoint: 40 },
    ]
  })

  console.log('Created inventory')

  // Create Vehicles
  const vehicle1 = await prisma.vehicle.create({
    data: {
      licensePlate: 'ABC-1234',
      type: 'VAN',
      make: 'Ford',
      model: 'Transit',
      year: 2022,
      capacity: 1500,
      volume: 10,
      status: 'AVAILABLE',
      fuelType: 'diesel',
      mileage: 25000,
    }
  })

  const vehicle2 = await prisma.vehicle.create({
    data: {
      licensePlate: 'XYZ-5678',
      type: 'TRUCK',
      make: 'Mercedes',
      model: 'Sprinter',
      year: 2023,
      capacity: 2500,
      volume: 15,
      status: 'IN_USE',
      fuelType: 'diesel',
      mileage: 15000,
    }
  })

  const vehicle3 = await prisma.vehicle.create({
    data: {
      licensePlate: 'MOT-0001',
      type: 'MOTORCYCLE',
      make: 'Honda',
      model: 'PCX',
      year: 2023,
      capacity: 50,
      volume: 0.5,
      status: 'AVAILABLE',
      fuelType: 'gasoline',
      mileage: 5000,
    }
  })

  console.log('Created vehicles')

  // Create Driver Profile
  const driver = await prisma.driver.create({
    data: {
      userId: driverUser.id,
      licenseNumber: 'DL-NY-12345',
      licenseType: 'B',
      licenseExpiry: new Date('2025-12-31'),
      phone: driverUser.phone,
      address: '789 Driver Lane',
      city: 'New York',
      province: 'NY',
      zipCode: '10002',
      rating: 4.8,
      totalDeliveries: 156,
      isActive: true,
    }
  })

  console.log('Created driver')

  // Create Orders
  const order1 = await prisma.order.create({
    data: {
      orderNumber: 'ORD-2024-0001',
      customerId: customer.id,
      shippingName: customer.name,
      shippingPhone: customer.phone || '',
      shippingAddress: customer.address || '',
      shippingCity: customer.city || '',
      shippingProvince: customer.province || '',
      shippingZipCode: customer.zipCode || '',
      shippingCountry: customer.country,
      shippingLatitude: customer.latitude,
      shippingLongitude: customer.longitude,
      status: 'DELIVERED',
      subtotal: 179.98,
      tax: 14.40,
      totalAmount: 194.38,
      paymentStatus: 'paid',
      paymentMethod: 'credit_card',
      deliveredAt: new Date(),
      items: {
        create: [
          { productId: product1.id, quantity: 1, unitPrice: 149.99, totalPrice: 149.99 },
          { productId: product2.id, quantity: 1, unitPrice: 29.99, totalPrice: 29.99 }
        ]
      }
    }
  })

  const order2 = await prisma.order.create({
    data: {
      orderNumber: 'ORD-2024-0002',
      customerId: customer.id,
      shippingName: customer.name,
      shippingPhone: customer.phone || '',
      shippingAddress: '456 Different St',
      shippingCity: 'Brooklyn',
      shippingProvince: 'NY',
      shippingZipCode: '11201',
      shippingCountry: 'USA',
      shippingLatitude: 40.6782,
      shippingLongitude: -73.9442,
      status: 'DISPATCHED',
      subtotal: 84.98,
      tax: 6.80,
      totalAmount: 91.78,
      paymentStatus: 'paid',
      paymentMethod: 'credit_card',
      items: {
        create: [
          { productId: product3.id, quantity: 2, unitPrice: 24.99, totalPrice: 49.98 },
          { productId: product2.id, quantity: 1, unitPrice: 29.99, totalPrice: 29.99 }
        ]
      }
    }
  })

  const order3 = await prisma.order.create({
    data: {
      orderNumber: 'ORD-2024-0003',
      customerId: customer2.id,
      shippingName: customer2.name,
      shippingPhone: customer2.phone || '',
      shippingAddress: customer2.address || '',
      shippingCity: customer2.city || '',
      shippingProvince: customer2.province || '',
      shippingZipCode: customer2.zipCode || '',
      shippingCountry: customer2.country,
      status: 'PROCESSING',
      subtotal: 59.99,
      tax: 4.80,
      totalAmount: 64.79,
      paymentStatus: 'pending',
      items: {
        create: [
          { productId: product4.id, quantity: 1, unitPrice: 59.99, totalPrice: 59.99 }
        ]
      }
    }
  })

  console.log('Created orders')

  // Create Trip
  const trip = await prisma.trip.create({
    data: {
      tripNumber: 'TRP-2024-0001',
      driverId: driver.id,
      vehicleId: vehicle2.id,
      warehouseId: warehouse.id,
      status: 'IN_PROGRESS',
      startLocation: 'Main Distribution Center',
      startLatitude: warehouse.latitude,
      startLongitude: warehouse.longitude,
      totalDistance: 45.5,
      estimatedTime: 120,
      plannedStartAt: new Date(),
      actualStartAt: new Date(),
      totalDropPoints: 2,
      completedDropPoints: 1,
      dropPoints: {
        create: [
          {
            order: { connect: { id: order1.id } },
            dropPointType: 'DELIVERY',
            sequence: 1,
            status: 'COMPLETED',
            locationName: customer.name,
            address: order1.shippingAddress,
            city: order1.shippingCity,
            province: order1.shippingProvince,
            zipCode: order1.shippingZipCode,
            latitude: order1.shippingLatitude,
            longitude: order1.shippingLongitude,
            contactName: customer.name,
            contactPhone: customer.phone,
            actualArrival: new Date(),
            actualDeparture: new Date(),
          },
          {
            order: { connect: { id: order2.id } },
            dropPointType: 'DELIVERY',
            sequence: 2,
            status: 'PENDING',
            locationName: 'Brooklyn Delivery',
            address: order2.shippingAddress,
            city: order2.shippingCity,
            province: order2.shippingProvince,
            zipCode: order2.shippingZipCode,
            latitude: order2.shippingLatitude,
            longitude: order2.shippingLongitude,
            contactName: customer.name,
            contactPhone: customer.phone,
          }
        ]
      }
    }
  })

  console.log('Created trip')

  // Create Feedback
  await prisma.feedback.create({
    data: {
      customerId: customer.id,
      orderId: order1.id,
      type: 'COMPLIMENT',
      subject: 'Excellent Delivery Service',
      message: 'The delivery was on time and the driver was very professional. Great experience!',
      rating: 5,
      status: 'CLOSED',
    }
  })

  console.log('Created feedback')

  // Create Audit Logs
  await prisma.auditLog.create({
    data: {
      userId: adminUser.id,
      action: 'CREATE',
      entityType: 'ORDER',
      entityId: order1.id,
      newValue: JSON.stringify({ orderNumber: order1.orderNumber }),
    }
  })

  console.log('Created audit logs')

  console.log('Seeding completed successfully!')
  console.log('\n--- Test Accounts ---')
  console.log('Admin: admin@logistics.com / admin123')
  console.log('Driver: driver@logistics.com / driver123')
  console.log('Customer: customer@example.com / customer123')
}

main()
  .catch((e) => {
    console.error('Seeding error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
