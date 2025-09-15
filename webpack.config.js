const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = (env = {}) => ({
    entry: './js/index.js',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: env.cloudflare ? '[name].[contenthash].js' : 'index.js',
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
                use: ['style-loader', 'css-loader']
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
        })
    ],
    mode: env.production || env.cloudflare ? 'production' : 'development',
    optimization: {
        splitChunks: env.cloudflare ? {
            chunks: 'all'
        } : false
    },
    devServer: {
        static: {
            directory: path.join(__dirname, 'dist'),
        },
        compress: true,
        port: 8080,
    },
});