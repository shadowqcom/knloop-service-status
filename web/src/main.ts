import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('缺少 #app 挂载节点');

export default mount(App, { target });
