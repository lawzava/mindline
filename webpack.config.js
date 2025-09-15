const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = (env = {}) => ({
    entry: './js/index.js',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].[contenthash].js', // Always use content hash for cache busting
        clean: true,
        publicPath: '/'
    },
    experiments: {
        asyncWebAssembly: true,
    },
    module: {
        rules: [
            {
                test: /\.css$/,
                use: [
                    !!(env.production || env.cloudflare) ? MiniCssExtractPlugin.loader : 'style-loader',
                    'css-loader'
                ]
            }
        ]
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: './index.html',
            minify: !!(env.production || env.cloudflare)
        }),
        new webpack.DefinePlugin({
            'process.env.SIGNALING_SERVER': JSON.stringify(process.env.SIGNALING_SERVER || 'localhost:3000'),
            'process.env.USE_SSL': JSON.stringify(process.env.USE_SSL || 'false')
        }),
        new CopyPlugin({
            patterns: [
                { from: 'js/env-config.js', to: 'js/env-config.js' },
                { from: 'js/config.js', to: 'js/config.js' },
                { from: 'manifest.json', to: 'manifest.json' },
                { from: 'sw.js', to: 'sw.js' },
                { from: 'icons', to: 'icons', noErrorOnMissing: true },
                { from: 'screenshots', to: 'screenshots', noErrorOnMissing: true },
                { from: 'favicon.ico', to: 'favicon.ico', noErrorOnMissing: true }
            ]
        }),
        // Extract CSS with content hash for cache busting
        ...(!!(env.production || env.cloudflare) ? [
            new MiniCssExtractPlugin({
                filename: '[name].[contenthash].css',
                chunkFilename: '[id].[contenthash].css',
            })
        ] : [])
    ],
    mode: !!(env.production || env.cloudflare) ? 'production' : 'development',
    optimization: {
        // Enable tree shaking
        usedExports: true,
        sideEffects: false,

        // Minimize in production
        minimize: !!(env.production || env.cloudflare),

        // Advanced code splitting
        splitChunks: {
            chunks: 'all',
            minSize: 20000,
            maxSize: 244000,
            cacheGroups: {
                vendor: {
                    test: /[\\/]node_modules[\\/]/,
                    name: 'vendors',
                    chunks: 'all',
                    priority: 10,
                },
                common: {
                    name: 'common',
                    minChunks: 2,
                    chunks: 'all',
                    priority: 5,
                    reuseExistingChunk: true,
                },
                // Split debug utilities into separate chunk
                debug: {
                    test: /[\\/]js[\\/](logger|sanitizer)\.js$/,
                    name: 'debug-utils',
                    chunks: 'all',
                    priority: 8,
                }
            },
        },

        // Runtime chunk for better caching
        runtimeChunk: {
            name: 'runtime'
        }
    },
    // Performance hints
    performance: {
        hints: !!(env.production || env.cloudflare) ? 'warning' : false,
        maxEntrypointSize: 400000, // 400KB
        maxAssetSize: 200000, // 200KB
    },

    // Resolve optimizations
    resolve: {
        // Speed up resolution
        modules: ['node_modules'],
        extensions: ['.js', '.wasm'],

        // Create aliases for cleaner imports
        alias: {
            '@': path.resolve(__dirname, 'js'),
            '@css': path.resolve(__dirname, 'css'),
        }
    },

    devServer: {
        static: {
            directory: path.join(__dirname, 'dist'),
        },
        compress: true,
        port: 8080,
        hot: true, // Enable hot module replacement
        historyApiFallback: true, // Handle SPAs
        client: {
            overlay: {
                errors: true,
                warnings: false,
                runtimeErrors: (error) => {
                    // Suppress HMR errors for WASM modules
                    if (error.message && error.message.includes('mindline.js is not accepted')) {
                        return false;
                    }
                    return true;
                }
            }
        }
    },
});