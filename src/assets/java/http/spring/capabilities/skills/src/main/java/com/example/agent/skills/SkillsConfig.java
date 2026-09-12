package com.example.agent.skills;

import java.util.List;

import org.springaicommunity.agent.tools.SkillsTool;
import org.springaicommunity.agent.tools.SkillsTool.Skill;
import org.springaicommunity.agent.utils.Skills;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.ToolCallbackProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;

/**
 * Exposes the exported harness's agent skills to the model. Skills are SKILL.md knowledge modules
 * (YAML front-matter plus markdown) that the community {@code spring-ai-agent-utils} SkillsTool loads
 * and surfaces via <em>progressive disclosure</em>: the tool's description lists each skill's name and
 * description, and the model invokes the {@code Skill} tool with a skill name to load its full
 * instructions on demand. Skills are instruction/context, not executable tools.
 *
 * <p>Path skills are staged by the CLI into src/main/resources/skills/&lt;name&gt;/ at export, so they
 * are packaged into the Spring Boot jar and discovered here by classpath scanning — both when running
 * exploded (mvn spring-boot:run, reading target/classes/skills) and from the jar. The resulting
 * {@link ToolCallback} is wrapped in a {@link ToolCallbackProvider} bean, which the base ChatService
 * composes into its tool list with no ChatService change. There is no Spring Boot auto-configuration
 * behind SkillsTool, so the agent boots inert; skill content is read only when the tool is invoked.
 */
@Configuration
public class SkillsConfig {

    private static final String SKILLS_CLASSPATH_ROOT = "skills";

    /**
     * Registers the {@code Skill} tool over the skills packaged on the classpath. When no SKILL.md is
     * present (e.g. every declared path skill was assumed to live in the base image and was not staged
     * locally), no skill is registered and an empty provider is returned so the agent still boots —
     * SkillsTool.build() otherwise requires at least one skill.
     */
    @Bean
    ToolCallbackProvider skillsToolCallbackProvider() {
        ClassPathResource skillsRoot = new ClassPathResource(SKILLS_CLASSPATH_ROOT);
        List<Skill> skills = Skills.loadResource(skillsRoot);
        if (skills.isEmpty()) {
            return ToolCallbackProvider.from();
        }
        ToolCallback skillsTool = SkillsTool.builder().addSkillsResource(skillsRoot).build();
        return ToolCallbackProvider.from(skillsTool);
    }
}
