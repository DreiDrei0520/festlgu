Create a fully functional, production-ready, responsive web application called Festival Tourism Management System.

This project is for an LGU Tourism Office to manage festival information, event organizers, MSMEs (stall owners), and tourists using a centralized system with role-based access control.

Tech Stack

Use the following technologies:

React.js
TypeScript
Vite
Tailwind CSS
React Router
Firebase Authentication OR Supabase Auth (prefer Supabase if available)
Supabase PostgreSQL Database (or Firebase Firestore if Supabase is unavailable)
Supabase Storage for images/documents
QR Code Generator
QR Code Scanner
Chart.js
Framer Motion
React Hook Form
Zod Validation

The project should be fully responsive and optimized for desktop, tablet, and mobile.

Authentication

Implement secure authentication.

Roles:

System Admin / LGU Tourism Office
Event Organizer
MSME / Stall Owner
Tourist / Visitor

Features:

Login
Register
Forgot Password
Email Verification
Protected Routes
Role-Based Access Control (RBAC)
Session Persistence
Logout

After login, redirect users to their respective dashboard.

User Roles
1. System Admin / LGU Tourism Office

Full access to every module.

Can:

Manage all users
Approve accounts
Add/Edit/Delete users
Manage festivals
Manage events
Manage MSMEs
Upload documents
Upload announcements
Manage tourism information
View all reports
Generate Market Analysis
View dashboard analytics
View QR code logs
View tourist feedback
Manage rewards

Dashboard should include:

Total Users
Total Events
Total MSMEs
Total Visitors
Feedback Analytics
Market Analysis
Revenue Charts
Visitor Statistics
QR Statistics
Recent Activities
2. Event Organizer

Only manages festival information.

Can:

Add events
Edit events
Delete events
Update schedules
Update venues
Upload event posters
Publish announcements
Manage festival programs

Dashboard:

Event Calendar
Upcoming Events
Festival Timeline
Programs
Event Status
Notifications
3. MSME / Stall Owner

Business management dashboard.

Can:

Manage products
Upload product photos
Set prices
Manage inventory
Generate QR Codes
View reward scans
View customer transactions

Dashboard:

Products
QR Generator
Customer Reward Logs
Sales Summary
Inventory
4. Tourist / Visitor

Can:

Register/Login
Browse festivals
Browse products
Browse events
View schedules
View maps
Scan QR Codes
Earn reward points
Redeem rewards
Submit feedback
Submit suggestions
Save favorite events

Dashboard:

Upcoming Events
My Reward Points
My Feedback
Notifications
Redeem Rewards
QR Code System

Create TWO independent QR systems.

Login/Register QR

Every account automatically has a personal QR Code.

Scanning opens:

Login
Profile
Registration

Available for all users.

Reward QR

Only MSMEs can generate.

Flow:

Customer buys a product

↓

MSME generates transaction QR Code

↓

Tourist scans QR

↓

Points are automatically added

↓

Customer can redeem rewards

Store every transaction in the database.

Database Design

Create tables/collections for:

Users

id
fullname
email
password
role
profile_photo
created_at

Festivals

id
title
description
banner
location
start_date
end_date

Events

id
festival_id
title
description
venue
start_time
end_time
organizer_id

MSMEs

id
owner
business_name
logo
description

Products

id
msme_id
product_name
image
description
price
stock

Reward QR

id
product_id
qr_code
points

Transactions

id
tourist_id
msme_id
qr_id
points
created_at

Rewards

id
reward_name
required_points
image

Redeemed Rewards

id
tourist_id
reward_id
redeemed_date

Feedback

id
tourist_id
rating
comment
suggestion
created_at

Announcements

id
title
description
image
created_by

Market Analysis

id
report
generated_date
Admin Analytics

Create beautiful dashboards with charts.

Include:

Visitors per Day
Visitors per Month
Event Attendance
Product Popularity
MSME Participation
Feedback Ratings
Tourist Demographics
QR Scans
Reward Redemption
Sales Reports

Use Chart.js.

Public Website

Create modern pages.

Home

Festival highlights

Hero section

Featured events

Countdown timer

Announcements

Gallery

Sponsors

About

Festival history

Mission

Vision

Tourism information

Events

Calendar view

Timeline

MSMEs

Business directory

Products

Tourist Guide

Maps

Transportation

Hotels

Restaurants

Emergency Contacts

Contact

Feedback Form

FAQ

Design

Use a premium modern UI.

Theme:

Green
Blue
Gold
White

Style:

Glassmorphism
Rounded cards
Smooth animations
Icons
Interactive charts
Beautiful tables
Responsive sidebar
Dark Mode
Light Mode
Functional Requirements

Generate real React components.

Use reusable components.

Implement CRUD functionality connected to Supabase/Firebase.

Implement real authentication.

Connect every form to the database.

Use loading states.

Use toast notifications.

Validate every form.

Implement search.

Implement filters.

Implement pagination.

Implement image uploads.

Implement file uploads.

Implement role protection.

Implement responsive layouts.

Use clean folder architecture.

Include comments in important code.

Final Goal

Generate a fully working, scalable, production-ready Festival Tourism Management System with real authentication, role-based dashboards, QR code generation and scanning, analytics, CRUD operations, responsive UI, and complete integration with Supabase (preferred) or Firebase. Ensure the generated project is clean, modular, and can be run immediately after adding the required Supabase/Firebase environment variables.