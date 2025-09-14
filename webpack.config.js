const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

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