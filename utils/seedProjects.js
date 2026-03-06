const mongoose = require('mongoose');
const Project = require('../models/Project');
require('dotenv').config();

// Sample project data for simplified schema
const projectsData = [
  {
    name: "HotLead in a Box",
    description: "Complete lead generation system with automated outreach, lead scoring, and conversion tracking. Perfect for B2B sales teams looking to scale their pipeline. This comprehensive solution combines intelligent prospecting, automated outreach sequences, and advanced analytics to help you identify high-quality leads, engage them with personalized messaging, and track their journey through your sales funnel. Built for modern B2B sales teams who want to scale their outreach without sacrificing personalization.",
    status: "active",
    isPublished: true,
    isFeatured: true,
    thumbnailImage: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=400&h=250&fit=crop",
    features: [
      "Automated lead discovery and qualification system",
      "Multi-channel outreach campaigns (Email, LinkedIn, Cold calls)",
      "Lead scoring and prioritization system",
      "CRM integration and pipeline tracking",
      "A/B testing for messaging optimization",
      "Real-time analytics and reporting dashboard",
      "Personalized email templates and sequences",
      "LinkedIn automation and connection management"
    ],
    benefits: [
      "Increase lead generation by 3x within 30 days",
      "Reduce manual prospecting time by 80%",
      "Improve lead quality and conversion rates",
      "Scale outreach without hiring more SDRs",
      "Get better visibility into your sales pipeline",
      "Optimize messaging based on performance data",
      "Accelerate sales cycle with qualified leads",
      "Boost revenue with systematic approach"
    ],
    tags: [
      "lead-generation",
      "sales",
      "automation",
      "b2b",
      "outreach",
      "crm",
      "prospecting",
      "email-marketing",
      "linkedin",
      "analytics"
    ],
    version: "1.0.0"
  },
  {
    name: "Sales Funnel Accelerator",
    description: "Optimize your entire sales funnel with advanced analytics, conversion tracking, and automated nurturing sequences. A comprehensive funnel optimization system that helps you identify bottlenecks, improve conversion rates at each stage, and automate prospect nurturing. Perfect for businesses looking to maximize their sales efficiency and scale their revenue operations.",
    status: "active",
    isPublished: true,
    isFeatured: true,
    thumbnailImage: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=400&h=250&fit=crop",
    features: [
      "Funnel visualization and mapping tools",
      "Conversion rate optimization framework",
      "Automated nurturing sequences",
      "Advanced analytics and insights dashboard",
      "A/B testing for funnel optimization",
      "ROI tracking and attribution modeling"
    ],
    benefits: [
      "Increase overall conversion rates by 40%",
      "Identify and fix funnel bottlenecks quickly",
      "Automate prospect nurturing effectively",
      "Get clear ROI visibility across channels",
      "Optimize marketing spend allocation",
      "Reduce customer acquisition costs"
    ],
    tags: [
      "sales-funnel",
      "conversion",
      "analytics",
      "optimization",
      "roi",
      "automation",
      "nurturing"
    ],
    version: "1.0.0"
  },
  {
    name: "Content Marketing Accelerator",
    description: "Scale your content marketing with AI-powered content creation, distribution automation, and performance tracking. Transform your content marketing strategy with automated content planning, creation workflows, multi-channel distribution, and comprehensive performance analytics. Perfect for marketing teams looking to scale content production while maintaining quality.",
    status: "active",
    isPublished: true,
    isFeatured: false,
    thumbnailImage: "https://images.unsplash.com/photo-1552664730-d307ca884978?w=400&h=250&fit=crop",
    features: [
      "Content calendar planning and automation",
      "AI-powered content suggestions",
      "Multi-channel content distribution",
      "SEO optimization tools",
      "Performance analytics and reporting",
      "Content repurposing workflows"
    ],
    benefits: [
      "Increase content production by 500%",
      "Improve content engagement rates",
      "Streamline content approval workflows",
      "Boost organic traffic and SEO rankings",
      "Reduce content creation costs",
      "Better content performance insights"
    ],
    tags: [
      "content-marketing",
      "seo",
      "social-media",
      "automation",
      "analytics",
      "ai-powered"
    ],
    version: "1.0.0"
  },
  {
    name: "Customer Retention Engine",
    description: "Reduce churn and increase customer lifetime value with predictive analytics and automated retention campaigns. A powerful system designed to identify at-risk customers, predict churn probability, and automatically trigger retention campaigns. Includes customer health scoring, win-back sequences, and loyalty program automation.",
    status: "coming-soon",
    isPublished: true,
    isFeatured: false,
    thumbnailImage: "https://images.unsplash.com/photo-1553484771-371a605b060b?w=400&h=250&fit=crop",
    features: [
      "Churn prediction modeling",
      "Customer health scoring system",
      "Automated retention campaigns",
      "Win-back email sequences",
      "Loyalty program automation",
      "Customer success dashboards"
    ],
    benefits: [
      "Reduce churn rate by up to 25%",
      "Increase customer lifetime value",
      "Proactive customer success management",
      "Automated win-back campaigns",
      "Improved customer satisfaction scores",
      "Higher revenue retention"
    ],
    tags: [
      "retention",
      "churn",
      "customer-success",
      "loyalty",
      "analytics",
      "automation"
    ],
    version: "1.0.0"
  },
  {
    name: "ABM Campaign Builder",
    description: "Execute targeted account-based marketing campaigns with personalized content, multi-touch sequences, and account intelligence. A complete account-based marketing solution that helps you identify high-value target accounts, create personalized campaigns, orchestrate multi-touch sequences, and measure account engagement. Built for B2B companies focused on enterprise sales.",
    status: "active",
    isPublished: true,
    isFeatured: false,
    thumbnailImage: "https://images.unsplash.com/photo-1560472354-b33ff0c44a43?w=400&h=250&fit=crop",
    features: [
      "Account identification and scoring",
      "Personalized campaign creation",
      "Multi-channel orchestration",
      "Account intelligence dashboard",
      "Engagement tracking and attribution",
      "Sales and marketing alignment tools"
    ],
    benefits: [
      "Increase deal size by 40%",
      "Shorten sales cycles significantly",
      "Improve marketing-sales alignment",
      "Higher conversion rates on target accounts",
      "Better ROI on marketing spend",
      "Enhanced customer experience"
    ],
    tags: [
      "abm",
      "account-based-marketing",
      "b2b",
      "enterprise",
      "personalization",
      "sales-alignment"
    ],
    version: "1.0.0"
  }
];

async function seedProjects() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Clear existing projects (optional - comment this out if you want to keep existing data)
    await Project.deleteMany({});
    console.log('🗑️  Cleared existing projects');

    // Create a default user ID (you might want to use an actual user ID from your database)
    const defaultUserId = new mongoose.Types.ObjectId();

    // Add createdBy field to all projects
    const projectsWithCreator = projectsData.map(project => ({
      ...project,
      createdBy: defaultUserId
    }));

    // Insert projects
    const createdProjects = await Project.insertMany(projectsWithCreator);
    console.log(`✅ Created ${createdProjects.length} projects successfully`);

    // Log created projects
    createdProjects.forEach(project => {
      console.log(`   📦 ${project.name} (${project.slug}) - ${project.status}`);
    });

    console.log('\n🎉 Project seeding completed successfully!');
    console.log('\n📋 Summary:');
    console.log(`   • Total projects: ${createdProjects.length}`);
    console.log(`   • Active projects: ${createdProjects.filter(p => p.status === 'active').length}`);
    console.log(`   • Featured projects: ${createdProjects.filter(p => p.isFeatured).length}`);
    console.log(`   • Published projects: ${createdProjects.filter(p => p.isPublished).length}`);

  } catch (error) {
    console.error('❌ Error seeding projects:', error);
  } finally {
    // Close the connection
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
}

// Run the seeding function if this script is executed directly
if (require.main === module) {
  seedProjects();
}

module.exports = { seedProjects, projectsData };
