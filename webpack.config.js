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
                    env.production || env.cloudflare ? MiniCssExtractPlugin.loader : 'style-loader',
                    'css-loader'
                ]
            }
        ]
    },
    plugins: [
        new HtmlWebpackPlugin({
            template: './index.html',
            minify: env.production || env.cloudflare
        }),
        new webpack.DefinePlugin({
            'process.env.SIGNALING_SERVER': JSON.stringify(process.env.SIGNALING_SERVER || 'localhost:3000'),
            'process.env.USE_SSL': JSON.stringify(process.env.USE_SSL || 'false')
        }),
        new CopyPlugin({
            patterns: [
                { from: 'js/env-config.js', to: 'js/env-config.js' },
                { from: 'js/config.js', to: 'js/config.js' }
            ]
        }),
        // Extract CSS with content hash for cache busting
        ...(env.production || env.cloudflare ? [
            new MiniCssExtractPlugin({
                filename: '[name].[contenthash].css',
                chunkFilename: '[id].[contenthash].css',
            })
        ] : [])
    ],
    mode: env.production || env.cloudflare ? 'production' : 'development',
    optimization: {
        splitChunks: {
            chunks: 'all',
            cacheGroups: {
                vendor: {
                    test: /[\\/]node_modules[\\/]/,
                    name: 'vendors',
                    chunks: 'all',
                },
            },
        }
    },
    devServer: {
        static: {
            directory: path.join(__dirname, 'dist'),
        },
        compress: true,
        port: 8080,
    },
});