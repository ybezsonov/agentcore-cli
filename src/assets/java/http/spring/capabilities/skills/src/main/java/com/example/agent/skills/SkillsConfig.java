package com.example.agent.skills;

import org.springaicommunity.agent.tools.SkillsTool;
import org.springframework.ai.tool.ToolCallbackProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;

@Configuration
public class SkillsConfig {

    @Bean
    ToolCallbackProvider skillsToolCallbackProvider() {
        // SkillsTool parses the packaged SKILL.md files once at boot and performs no network access.
        return ToolCallbackProvider.from(
            SkillsTool.builder().addSkillsResource(new ClassPathResource("skills/")).build()
        );
    }
}
