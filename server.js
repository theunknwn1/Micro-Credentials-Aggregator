const express = require('express');
const cors = require('cors');
const path = require('path');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:5500', 'http://127.0.0.1:3001'],
    credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Helper function to simulate database delay
const simulateDelay = (min = 800, max = 2000) => {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return new Promise(resolve => setTimeout(resolve, delay));
};

// Helper function to format certificate data with computed fields
const formatCertificate = (cert) => {
    const now = new Date();
    const completionDate = new Date(cert.completionDate);
    const expiryDate = cert.expiryDate ? new Date(cert.expiryDate) : null;
    
    return {
        ...cert,
        completionDate: cert.completionDate,
        issueDate: cert.issueDate,
        expiryDate: cert.expiryDate,
        isExpired: expiryDate ? expiryDate < now : false,
        daysUntilExpiry: expiryDate ? 
            Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24)) : null,
        ageInDays: Math.floor((now - completionDate) / (1000 * 60 * 60 * 24)),
        isRecent: Math.floor((now - completionDate) / (1000 * 60 * 60 * 24)) <= 30
    };
};

// API Routes

// Health check endpoint
app.get('/api/health', async (req, res) => {
    try {
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            environment: process.env.NODE_ENV || 'development',
            uptime: process.uptime(),
            memory: process.memoryUsage()
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Get all available users (for testing/demo)
app.get('/api/users', async (req, res) => {
    try {
        await simulateDelay(300, 800);
        
        // Load user data from data.json
        const fs = require('fs');
        let userData;
        
        try {
            const dataFile = path.join(__dirname, 'data.json');
            const rawData = fs.readFileSync(dataFile, 'utf8');
            userData = JSON.parse(rawData);
        } catch (fileError) {
            console.log('data.json not found, using embedded mock data');
            userData = require('./data.json'); // This will work if data.json is available
        }
        
        const users = Object.values(userData).map(user => ({
            id: user.id,
            name: user.name,
            email: user.email,
            totalCertificates: user.totalCertificates,
            totalHours: user.totalHours,
            joinDate: user.joinDate,
            profileImage: user.profileImage || `https://via.placeholder.com/150x150/2563eb/white?text=${user.name.charAt(0)}`
        }));
        
        res.json({
            success: true,
            data: users,
            count: users.length,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'Failed to retrieve users',
            timestamp: new Date().toISOString()
        });
    }
});

// Main endpoint: Get certificates for a specific user
app.get('/api/certificates/:userid', async (req, res) => {
    try {
        const { userid } = req.params;
        const { 
            platform, 
            category, 
            sortBy = 'newest', 
            search,
            limit,
            offset = 0,
            includeExpired = true
        } = req.query;
        
        // Input validation
        if (!userid || userid.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Bad Request',
                message: 'User ID is required',
                timestamp: new Date().toISOString()
            });
        }
        
        // Simulate realistic network delay
        await simulateDelay();
        
        // Load user data
        let userData;
        try {
            const fs = require('fs');
            const dataFile = path.join(__dirname, 'data.json');
            const rawData = fs.readFileSync(dataFile, 'utf8');
            userData = JSON.parse(rawData);
        } catch (fileError) {
            console.log('Using fallback data due to file error:', fileError.message);
            // Fallback embedded data would go here
            return res.status(500).json({
                success: false,
                error: 'Data source unavailable',
                message: 'Please ensure data.json file exists',
                timestamp: new Date().toISOString()
            });
        }
        
        // Find user in data
        const user = userData[userid.toLowerCase()];
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Not Found',
                message: `User with ID '${userid}' not found`,
                availableUsers: Object.keys(userData),
                timestamp: new Date().toISOString()
            });
        }
        
        // Process and format certificates
        let certificates = user.certificates.map(formatCertificate);
        
        // Apply filters
        if (platform) {
            certificates = certificates.filter(cert => 
                cert.platform.toLowerCase() === platform.toLowerCase()
            );
        }
        
        if (category) {
            certificates = certificates.filter(cert => 
                cert.category.toLowerCase() === category.toLowerCase()
            );
        }
        
        if (search) {
            const searchTerm = search.toLowerCase();
            certificates = certificates.filter(cert =>
                cert.courseName.toLowerCase().includes(searchTerm) ||
                cert.institution.toLowerCase().includes(searchTerm) ||
                cert.platform.toLowerCase().includes(searchTerm) ||
                cert.description.toLowerCase().includes(searchTerm) ||
                cert.skills.some(skill => skill.toLowerCase().includes(searchTerm)) ||
                cert.category.toLowerCase().includes(searchTerm)
            );
        }
        
        if (!includeExpired) {
            certificates = certificates.filter(cert => !cert.isExpired);
        }
        
        // Apply sorting
        certificates.sort((a, b) => {
            switch (sortBy.toLowerCase()) {
                case 'newest':
                    return new Date(b.completionDate) - new Date(a.completionDate);
                case 'oldest':
                    return new Date(a.completionDate) - new Date(b.completionDate);
                case 'platform':
                    return a.platform.localeCompare(b.platform);
                case 'name':
                    return a.courseName.localeCompare(b.courseName);
                case 'grade':
                    const gradeA = a.grade && !isNaN(parseFloat(a.grade)) ? parseFloat(a.grade) : 0;
                    const gradeB = b.grade && !isNaN(parseFloat(b.grade)) ? parseFloat(b.grade) : 0;
                    return gradeB - gradeA;
                case 'hours':
                    return b.hours - a.hours;
                case 'category':
                    return a.category.localeCompare(b.category);
                case 'expiry':
                    // Sort by expiry date (nulls last)
                    if (!a.expiryDate && !b.expiryDate) return 0;
                    if (!a.expiryDate) return 1;
                    if (!b.expiryDate) return -1;
                    return new Date(a.expiryDate) - new Date(b.expiryDate);
                default:
                    return 0;
            }
        });
        
        // Apply pagination
        const total = certificates.length;
        const offsetNum = parseInt(offset) || 0;
        const limitNum = parseInt(limit) || certificates.length;
        
        if (limitNum > 0) {
            certificates = certificates.slice(offsetNum, offsetNum + limitNum);
        }
        
        // Calculate comprehensive statistics
        const allCerts = user.certificates.map(formatCertificate);
        const stats = {
            totalCertificates: allCerts.length,
            filteredCertificates: total,
            returnedCertificates: certificates.length,
            totalHours: allCerts.reduce((sum, cert) => sum + (cert.hours || 0), 0),
            totalCredits: allCerts.reduce((sum, cert) => sum + (cert.creditsEarned || 0), 0),
            platforms: [...new Set(allCerts.map(cert => cert.platform))],
            categories: [...new Set(allCerts.map(cert => cert.category))],
            verificationStatus: {
                verified: allCerts.filter(cert => cert.verificationStatus === 'Verified').length,
                pending: allCerts.filter(cert => cert.verificationStatus === 'Pending').length,
                expired: allCerts.filter(cert => cert.isExpired).length
            },
            averageGrade: (() => {
                const gradesWithNumbers = allCerts
                    .filter(cert => cert.grade && !isNaN(parseFloat(cert.grade)))
                    .map(cert => parseFloat(cert.grade));
                
                if (gradesWithNumbers.length === 0) return null;
                return Math.round((gradesWithNumbers.reduce((sum, grade) => sum + grade, 0) / gradesWithNumbers.length) * 100) / 100;
            })(),
            recentCertificates: allCerts.filter(cert => cert.isRecent).length,
            expiringCertificates: allCerts.filter(cert => {
                if (!cert.expiryDate) return false;
                const daysUntil = cert.daysUntilExpiry;
                return daysUntil <= 30 && daysUntil > 0;
            }).length,
            skillsCount: [...new Set(allCerts.flatMap(cert => cert.skills || []))].length,
            learningTrend: (() => {
                const months = {};
                allCerts.forEach(cert => {
                    const date = new Date(cert.completionDate);
                    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                    months[monthKey] = (months[monthKey] || 0) + 1;
                });
                return months;
            })()
        };
        
        // Prepare user profile with enhanced data
        const userProfile = {
            id: user.id,
            name: user.name,
            email: user.email,
            joinDate: user.joinDate,
            profileImage: user.profileImage || `https://via.placeholder.com/150x150/2563eb/white?text=${user.name.charAt(0)}`,
            bio: user.bio || `Professional with ${allCerts.length} verified certificates and ${stats.totalHours} hours of learning`,
            location: user.location || 'Global',
            linkedin: user.linkedin,
            github: user.github,
            website: user.website,
            portfolio: user.portfolio,
            totalCertificates: allCerts.length,
            totalHours: stats.totalHours,
            memberSince: Math.floor((new Date() - new Date(user.joinDate)) / (1000 * 60 * 60 * 24))
        };
        
        // Enhanced response with additional metadata
        res.json({
            success: true,
            data: {
                user: userProfile,
                certificates: certificates,
                statistics: stats,
                pagination: {
                    offset: offsetNum,
                    limit: limitNum,
                    total: total,
                    hasMore: offsetNum + limitNum < total,
                    totalPages: Math.ceil(total / (limitNum || 1))
                },
                filters: {
                    platform,
                    category,
                    search,
                    sortBy,
                    includeExpired
                },
                metadata: {
                    lastUpdated: new Date().toISOString(),
                    dataVersion: '1.0',
                    apiVersion: '1.0',
                    processingTime: new Date().toISOString()
                }
            },
            timestamp: new Date().toISOString()
        });
        
        // Log the request for monitoring
        console.log(`[${new Date().toISOString()}] GET /api/certificates/${userid} - ${certificates.length}/${total} certificates returned`);
        
    } catch (error) {
        console.error('Error fetching certificates:', error);
        res.status(500).json({
            success: false,
            error: 'Internal Server Error',
            message: 'An unexpected error occurred while retrieving certificates',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined,
            timestamp: new Date().toISOString()
        });
    }
});

// Get detailed information about a specific certificate
app.get('/api/certificates/:userid/:certid', async (req, res) => {
    try {
        const { userid, certid } = req.params;
        
        await simulateDelay(200, 600);
        
        // Load user data
        const fs = require('fs');
        const dataFile = path.join(__dirname, 'data.json');
        const rawData = fs.readFileSync(dataFile, 'utf8');
        const userData = JSON.parse(rawData);
        
        const user = userData[userid.toLowerCase()];
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found',
                timestamp: new Date().toISOString()
            });
        }
        
        const certificate = user.certificates.find(cert => cert.id === certid);
        if (!certificate) {
            return res.status(404).json({
                success: false,
                error: 'Certificate not found',
                availableCertificates: user.certificates.map(cert => ({
                    id: cert.id,
                    name: cert.courseName
                })),
                timestamp: new Date().toISOString()
            });
        }
        
        // Add detailed verification information
        const detailedCertificate = {
            ...formatCertificate(certificate),
            verificationDetails: {
                verifiedBy: certificate.platform,
                verificationMethod: 'Digital signature',
                blockchainHash: `0x${Math.random().toString(16).substr(2, 8)}...`, // Mock blockchain hash
                lastVerified: new Date().toISOString(),
                publicKey: `${certificate.id}_public_key`,
                certificateHash: btoa(`${certificate.id}_${certificate.completionDate}_${user.id}`)
            },
            relatedCertificates: user.certificates
                .filter(cert => cert.id !== certid && 
                    (cert.platform === certificate.platform || 
                     cert.category === certificate.category))
                .map(cert => ({
                    id: cert.id,
                    name: cert.courseName,
                    platform: cert.platform,
                    category: cert.category
                }))
        };
        
        res.json({
            success: true,
            data: detailedCertificate,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error fetching certificate details:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'Failed to retrieve certificate details',
            timestamp: new Date().toISOString()
        });
    }
});

// Get user analytics and learning insights
app.get('/api/analytics/:userid', async (req, res) => {
    try {
        const { userid } = req.params;
        const { timeframe = '1y' } = req.query;
        
        await simulateDelay(400, 800);
        
        // Load user data
        const fs = require('fs');
        const dataFile = path.join(__dirname, 'data.json');
        const rawData = fs.readFileSync(dataFile, 'utf8');
        const userData = JSON.parse(rawData);
        
        const user = userData[userid.toLowerCase()];
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found',
                timestamp: new Date().toISOString()
            });
        }
        
        const certificates = user.certificates.map(formatCertificate);
        
        // Calculate comprehensive analytics
        const analytics = {
            learningVelocity: {
                certificatesPerMonth: certificates.length / Math.max(1, 
                    Math.ceil((new Date() - new Date(user.joinDate)) / (1000 * 60 * 60 * 24 * 30))),
                hoursPerMonth: certificates.reduce((sum, cert) => sum + cert.hours, 0) / 
                    Math.max(1, Math.ceil((new Date() - new Date(user.joinDate)) / (1000 * 60 * 60 * 24 * 30))),
                trend: 'increasing' // Could be calculated based on completion dates
            },
            skillsDevelopment: {
                topSkills: (() => {
                    const skillCounts = {};
                    certificates.forEach(cert => {
                        cert.skills.forEach(skill => {
                            skillCounts[skill] = (skillCounts[skill] || 0) + 1;
                        });
                    });
                    return Object.entries(skillCounts)
                        .sort(([,a], [,b]) => b - a)
                        .slice(0, 10)
                        .map(([skill, count]) => ({ skill, count, percentage: (count / certificates.length * 100).toFixed(1) }));
                })(),
                emergingSkills: certificates
                    .filter(cert => cert.ageInDays <= 90)
                    .flatMap(cert => cert.skills)
                    .filter((skill, index, arr) => arr.indexOf(skill) === index)
                    .slice(0, 5),
                skillCategories: (() => {
                    const categories = {};
                    certificates.forEach(cert => {
                        categories[cert.category] = (categories[cert.category] || 0) + 1;
                    });
                    return categories;
                })()
            },
            platformPreferences: {
                distribution: (() => {
                    const platforms = {};
                    certificates.forEach(cert => {
                        platforms[cert.platform] = (platforms[cert.platform] || 0) + 1;
                    });
                    return Object.entries(platforms)
                        .map(([platform, count]) => ({
                            platform,
                            count,
                            percentage: (count / certificates.length * 100).toFixed(1),
                            totalHours: certificates
                                .filter(cert => cert.platform === platform)
                                .reduce((sum, cert) => sum + cert.hours, 0)
                        }));
                })(),
                favoriteInstructors: certificates
                    .filter(cert => cert.instructor)
                    .reduce((acc, cert) => {
                        acc[cert.instructor] = (acc[cert.instructor] || 0) + 1;
                        return acc;
                    }, {}),
                averageRating: (() => {
                    const ratings = certificates
                        .filter(cert => cert.rating)
                        .map(cert => cert.rating);
                    return ratings.length ? (ratings.reduce((sum, r) => sum + r, 0) / ratings.length).toFixed(1) : null;
                })()
            },
            learningPatterns: {
                monthlyProgress: (() => {
                    const monthly = {};
                    certificates.forEach(cert => {
                        const date = new Date(cert.completionDate);
                        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                        if (!monthly[monthKey]) {
                            monthly[monthKey] = { certificates: 0, hours: 0 };
                        }
                        monthly[monthKey].certificates += 1;
                        monthly[monthKey].hours += cert.hours;
                    });
                    return monthly;
                })(),
                averageCompletionTime: certificates.reduce((sum, cert) => sum + cert.hours, 0) / certificates.length,
                consistencyScore: Math.min(100, certificates.length * 10), // Simple scoring algorithm
                streakDays: Math.floor(Math.random() * 30) + 1 // Mock streak calculation
            },
            achievements: {
                badges: [
                    ...(certificates.length >= 5 ? ['Learner'] : []),
                    ...(certificates.length >= 10 ? ['Dedicated Student'] : []),
                    ...(certificates.reduce((sum, cert) => sum + cert.hours, 0) >= 100 ? ['Century Club'] : []),
                    ...(new Set(certificates.map(cert => cert.platform)).size >= 3 ? ['Platform Explorer'] : [])
                ],
                milestones: [
                    {
                        title: 'First Certificate',
                        date: certificates.sort((a, b) => new Date(a.completionDate) - new Date(b.completionDate))[0]?.completionDate,
                        achieved: certificates.length > 0
                    },
                    {
                        title: '100 Learning Hours',
                        achieved: certificates.reduce((sum, cert) => sum + cert.hours, 0) >= 100,
                        progress: Math.min(100, certificates.reduce((sum, cert) => sum + cert.hours, 0))
                    },
                    {
                        title: 'Multi-Platform Learner',
                        achieved: new Set(certificates.map(cert => cert.platform)).size >= 3,
                        progress: new Set(certificates.map(cert => cert.platform)).size
                    }
                ]
            },
            careerRecommendations: {
                suggestedSkills: ['Python', 'Data Visualization', 'Machine Learning', 'Project Management'],
                careerPaths: ['Data Analyst', 'Full Stack Developer', 'Cloud Architect'],
                nextCertifications: [
                    'Advanced Data Science Specialization',
                    'Cloud Security Fundamentals',
                    'Leadership and Management'
                ]
            }
        };
        
        res.json({
            success: true,
            data: analytics,
            metadata: {
                userId: userid,
                analysisDate: new Date().toISOString(),
                timeframe: timeframe,
                totalCertificates: certificates.length,
                dataPoints: certificates.length * 10 // Mock complexity measure
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error generating analytics:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'Failed to generate analytics',
            timestamp: new Date().toISOString()
        });
    }
});

// Global search across all users and certificates
app.get('/api/search', async (req, res) => {
    try {
        const { q: query, type = 'all', limit = 50 } = req.query;
        
        if (!query || query.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Search query is required',
                timestamp: new Date().toISOString()
            });
        }
        
        await simulateDelay(300, 700);
        
        // Load all user data
        const fs = require('fs');
        const dataFile = path.join(__dirname, 'data.json');
        const rawData = fs.readFileSync(dataFile, 'utf8');
        const userData = JSON.parse(rawData);
        
        const searchTerm = query.toLowerCase();
        const results = [];
        
        // Search across all users and certificates
        Object.values(userData).forEach(user => {
            // Search in user profiles
            if (type === 'all' || type === 'users') {
                const userMatches = 
                    user.name.toLowerCase().includes(searchTerm) ||
                    user.email.toLowerCase().includes(searchTerm) ||
                    (user.bio && user.bio.toLowerCase().includes(searchTerm));
                
                if (userMatches) {
                    results.push({
                        type: 'user',
                        user: {
                            id: user.id,
                            name: user.name,
                            email: user.email,
                            totalCertificates: user.totalCertificates,
                            profileImage: user.profileImage
                        },
                        relevanceScore: 0.9
                    });
                }
            }
            
            // Search in certificates
            if (type === 'all' || type === 'certificates') {
                user.certificates.forEach(cert => {
                    const certMatches = 
                        cert.courseName.toLowerCase().includes(searchTerm) ||
                        cert.institution.toLowerCase().includes(searchTerm) ||
                        cert.platform.toLowerCase().includes(searchTerm) ||
                        cert.description.toLowerCase().includes(searchTerm) ||
                        cert.category.toLowerCase().includes(searchTerm) ||
                        cert.skills.some(skill => skill.toLowerCase().includes(searchTerm));
                    
                    if (certMatches) {
                        results.push({
                            type: 'certificate',
                            certificate: formatCertificate(cert),
                            user: {
                                id: user.id,
                                name: user.name,
                                email: user.email
                            },
                            relevanceScore: (() => {
                                let score = 0.5;
                                if (cert.courseName.toLowerCase().includes(searchTerm)) score += 0.3;
                                if (cert.skills.some(skill => skill.toLowerCase().includes(searchTerm))) score += 0.2;
                                return Math.min(1, score);
                            })()
                        });
                    }
                });
            }
        });
        
        // Sort by relevance score and apply limit
        const sortedResults = results
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .slice(0, parseInt(limit));
        
        res.json({
            success: true,
            data: sortedResults,
            metadata: {
                query: query,
                type: type,
                totalResults: results.length,
                returnedResults: sortedResults.length,
                searchTime: new Date().toISOString()
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error performing search:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'Search functionality temporarily unavailable',
            timestamp: new Date().toISOString()
        });
    }
});

// Serve static files (HTML, CSS, JS)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API documentation endpoint
app.get('/api/docs', (req, res) => {
    res.json({
        title: 'Micro-Credentials Aggregator API',
        version: '1.0.0',
        description: 'Professional certificate portfolio management API',
        endpoints: {
            'GET /api/health': 'System health check',
            'GET /api/users': 'List all available users',
            'GET /api/certificates/:userid': 'Get user certificates with filtering and pagination',
            'GET /api/certificates/:userid/:certid': 'Get detailed certificate information',
            'GET /api/analytics/:userid': 'Get user learning analytics and insights',
            'GET /api/search': 'Global search across users and certificates'
        },
        parameters: {
            'certificates endpoint': {
                platform: 'Filter by learning platform',
                category: 'Filter by certificate category',
                search: 'Text search across certificate data',
                sortBy: 'Sort criteria (newest, oldest, platform, name, grade, hours)',
                limit: 'Maximum number of results to return',
                offset: 'Number of results to skip for pagination',
                includeExpired: 'Include expired certificates (default: true)'
            }
        },
        sampleUsers: ['user1', 'user2', 'user3'],
        timestamp: new Date().toISOString()
    });
});

// Catch-all route for undefined API endpoints
app.get('/api/*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'API endpoint not found',
        message: `The endpoint ${req.path} does not exist`,
        availableEndpoints: [
            'GET /api/health',
            'GET /api/users',
            'GET /api/certificates/:userid',
            'GET /api/certificates/:userid/:certid',
            'GET /api/analytics/:userid',
            'GET /api/search',
            'GET /api/docs'
        ],
        timestamp: new Date().toISOString()
    });
});

// Serve index.html for all other routes (SPA support)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Global error handler middleware
app.use((error, req, res, next) => {
    console.error('Unhandled application error:', error);
    
    // Don't expose internal error details in production
    const errorMessage = process.env.NODE_ENV === 'production' 
        ? 'An internal server error occurred' 
        : error.message;
    
    res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: errorMessage,
        requestId: req.headers['x-request-id'] || 'unknown',
        timestamp: new Date().toISOString()
    });
});

// Add this route in server.js after other routes
app.get('/profile.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'profile.html'));
});

// Update the catch-all route to handle profile.html
app.get('*', (req, res) => {
    if (req.path === '/profile.html') {
        res.sendFile(path.join(__dirname, 'profile.html'));
    } else {
        res.sendFile(path.join(__dirname, 'index.html'));
    }
});


// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`🚀 Micro-Credentials Aggregator API Server`);
    console.log(`📍 Running on: http://localhost:${PORT}`);
    console.log(`🏥 Health Check: http://localhost:${PORT}/api/health`);
    console.log(`📚 API Documentation: http://localhost:${PORT}/api/docs`);
    console.log(`\n🔗 Available Endpoints:`);
    console.log(`   GET /api/users - List all users`);
    console.log(`   GET /api/certificates/:userid - Get user certificates`);
    console.log(`   GET /api/certificates/:userid/:certid - Get specific certificate`);
    console.log(`   GET /api/analytics/:userid - Get user analytics`);
    console.log(`   GET /api/search?q=term - Search certificates globally`);
    console.log(`\n💡 Demo Users: user1, user2, user3`);
    console.log(`\n⭐ Frontend available at: http://localhost:${PORT}`);
    console.log(`\n🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📊 Process ID: ${process.pid}`);
    console.log(`🚀 Ready for requests!\n`);
});

// Graceful shutdown handling
const gracefulShutdown = (signal) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    
    server.close((err) => {
        if (err) {
            console.error('Error during shutdown:', err);
            process.exit(1);
        }
        
        console.log('✅ Server closed successfully');
        console.log('🔒 All connections terminated');
        process.exit(0);
    });
    
    // Force shutdown after 30 seconds
    setTimeout(() => {
        console.error('⚠️  Forced shutdown after 30 seconds');
        process.exit(1);
    }, 30000);
};

// Listen for termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Export app for testing
module.exports = app;
