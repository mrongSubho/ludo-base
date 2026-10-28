"use client";

import React from "react";
import { useAuthPrompt, cancelAuthPrompt } from "@/hooks/useAuthPrompt";
import { SignWaitModal } from "./SignWaitModal";

export default function GlobalSignWaitModal() {
    const prompt = useAuthPrompt();

    return (
        <SignWaitModal
            isOpen={prompt.isOpen}
            mode={prompt.mode}
            title={prompt.title}
            badgeText={prompt.badgeText}
            statusText={prompt.statusText}
            networkText={prompt.networkText}
            explanationText={prompt.explanationText}
            cancelLabel={prompt.cancelLabel}
            telemetry={prompt.telemetry}
            onCancel={cancelAuthPrompt}
        />
    );
}
