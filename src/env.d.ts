/// <reference types="astro/client" />
declare namespace App {
    interface Locals {
        user?: {
            username: string;
            name: string;
            role: string;
        };
    }
}